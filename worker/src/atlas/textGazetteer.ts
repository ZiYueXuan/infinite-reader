import { gunzipSync } from 'fflate';
import type { TextAtlasPlace, TextAtlasResult } from '../../../shared/textAtlas';
import { sha256Hex, HttpError } from '../lib/util';
import manifest from './data/text-gazetteer.json';

export const TEXT_RESOLVER_VERSION = 6;
const MOUNTAIN_CODES = ['MT', 'MTS', 'PK', 'VLC'];

/** Refresh affected legacy results only after explicit generation consent. */
export function reusableTextResult(result: TextAtlasResult, resolverVersion?: number) {
  return resolverVersion === TEXT_RESOLVER_VERSION || (result.status === 'ready' && !result.unresolved.length
    && !!result.map && (resolverVersion === 2 || resolverVersion === 3 || resolverVersion === 4 || resolverVersion === 5 || result.map.places.every(p => !MOUNTAIN_CODES.includes(p.featureCode))));
}

// Alias metadata: language code, historical flag, valid-from, valid-to (source strings).
export type GeoAlias = [string, boolean, string, string];
export type GeoRecord = [string, string, number, number, string, string, string, string, string, GeoAlias[]];
export type PlaceKind = 'pass' | 'city' | 'settlement' | 'admin' | 'mountain' | 'mountain_range' | 'river' | 'site' | 'unknown';
export interface PlaceQuery { name: string; aliases: string[]; kind: PlaceKind; country: string }
export const normalizePlace = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const nameVariants = (name: string, query: PlaceQuery) => {
  // GeoNames may list only the formal 市 name for a Chinese city. Treat its
  // short/formal spelling as one name group, not contradictory alias evidence.
  if (query.country !== 'CN' || query.kind !== 'city' || !/^\p{Script=Han}{2,}$/u.test(name) || /[县縣区區省乡鄉镇鎮村]$/.test(name)) return [name];
  return [name, name.endsWith('市') ? name.slice(0, -1) : `${name}市`];
};
export interface GazetteerManifest {
  format: number; shards: number; objects: { key: string }[]; ranges: number[][];
}
export const MAX_GAZETTEER_SHARD_BYTES = 4 * 1024 * 1024;

export function gazetteerLookup(bucket: R2Bucket, config: GazetteerManifest = manifest) {
  // A small request-local cache bounds memory even when a passage names many places.
  const cache = new Map<number, Promise<Record<string, GeoRecord[]>>>();
  return async (name: string, country: string): Promise<GeoRecord[]> => {
    const normalized = normalizePlace(name);
    if (!normalized || !/^[A-Z]{2}$/.test(country)) return [];
    const key = `${country}:${normalized}`, shard = parseInt((await sha256Hex(key)).slice(0, 3), 16);
    let pending = cache.get(shard);
    if (!pending) {
      pending = (async () => {
        const range = config.ranges[shard], pack = config.objects[shard >> 8];
        if (config.format !== 2 || config.shards !== 4096 || !range || !pack || range[2]! > MAX_GAZETTEER_SHARD_BYTES) {
          throw new HttpError(503, 'gazetteer_unavailable', '地名库暂不可用，请稍后重试。');
        }
        const [offset, length, rawLength] = range;
        const object = await bucket.get(pack.key, { range: { offset, length } });
        if (!object) throw new HttpError(503, 'gazetteer_unavailable', '地名库暂不可用，请稍后重试。');
        const compressed = new Uint8Array(await object.arrayBuffer());
        if (compressed.length !== length) throw new HttpError(503, 'gazetteer_unavailable', '地名库暂不可用，请稍后重试。');
        const raw = gunzipSync(compressed, { out: new Uint8Array(rawLength!) });
        return JSON.parse(new TextDecoder().decode(raw));
      })();
      cache.set(shard, pending);
      if (cache.size > 2) cache.delete(cache.keys().next().value!);
    }
    return (await pending)[key] ?? [];
  };
}

const compatible = (r: GeoRecord, kind: PlaceKind) => {
  switch (kind) {
    case 'pass': return r[5] === 'PASS';
    case 'city': case 'settlement': return r[4] === 'P';
    case 'admin': return r[4] === 'A';
    case 'mountain': return MOUNTAIN_CODES.includes(r[5]);
    case 'mountain_range': return r[5] === 'MTS';
    case 'river': return ['STM', 'STMS'].includes(r[5]);
    case 'site': return r[4] === 'S';
    default: return true;
  }
};
const distance = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180, lat = (b[1] - a[1]) * rad, lon = (b[0] - a[0]) * rad;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(Math.sin(lat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(lon / 2) ** 2)));
};

/** Name/type/region constraints precede proximity. Never invent a coordinate. */
export async function resolveTextPlaces(queries: PlaceQuery[], region: string, lookup: (name: string, country: string) => Promise<GeoRecord[]>) {
  const places: TextAtlasPlace[] = [], unresolved: string[] = [];
  const regions = new Map<string, string | null>();
  const deferred: { query: PlaceQuery; rows: GeoRecord[] }[] = [];
  const add = (query: PlaceQuery, r: GeoRecord) => {
    if (places.some(p => p.id === `geonames:${r[0]}`)) return;
    places.push({ id: `geonames:${r[0]}`, name: query.name, modernName: r[1], coordinates: [r[2], r[3]], imagePoint: null,
      source: 'GeoNames', sourceUrl: `https://www.geonames.org/${r[0]}/`, featureCode: r[5], countryCode: r[8],
      historicalAlias: r[9].length > 0 && r[9].every(a => a[1]),
    });
  };
  for (const query of queries) {
    if (!regions.has(query.country)) {
      const matches = region ? (await lookup(region, query.country)).filter(r => r[8] === query.country && r[5] === 'ADM1') : [];
      regions.set(query.country, matches.length === 1 ? matches[0]![6] : null);
    }
    const admin1 = regions.get(query.country);
    let candidates: Map<string, GeoRecord> | undefined;
    let formalCityRows: GeoRecord[] = [];
    for (const name of [...new Set([query.name, ...query.aliases])]) {
      const rows: GeoRecord[] = [];
      const variants = nameVariants(name, query);
      for (const variant of variants) {
        const found = (await lookup(variant, query.country)).filter(r => r[8] === query.country);
        rows.push(...found);
        if (name === query.name && variants.length === 2 && variant.endsWith('市')) formalCityRows = found;
      }
      if (!rows.length) continue;
      const matches = new Map(rows.map(r => [r[0], r]));
      // A translation may narrow an ambiguous name, but never broaden or replace an exact match.
      candidates = candidates ? new Map([...candidates].filter(([id]) => matches.has(id))) : matches;
    }
    // Intersect names before type/region filtering: a recognized but incompatible alias
    // is contradictory evidence, not an absent name that can silently be ignored.
    let rows = [...(candidates?.values() ?? [])].filter(r => compatible(r, query.kind) && (!admin1 || r[6] === admin1)
      && !(query.country === 'CN' && query.kind === 'admin' && /县$/.test(query.name) && r[5] !== 'ADM3'));
    // Only an explicitly identified city may prefer an administrative seat over
    // same-name villages. Peer seats remain ambiguous; population never breaks ties.
    if (query.kind === 'city') {
      // Some real Chinese cities have only PPL, just like same-name villages.
      // A formal 市 alias plus a unique ADM2 with matching jurisdiction codes
      // can identify one such city, but never override alias/region constraints
      // or rank competing administrative seats.
      if (query.country === 'CN' && rows.length > 1 && rows.every(r => r[5] === 'PPL')) {
        const municipalities = formalCityRows.filter(r => r[5] === 'ADM2' && r[6] && r[7] && (!admin1 || r[6] === admin1));
        if (municipalities.length === 1) {
          const municipality = municipalities[0]!;
          const formalIds = new Set(formalCityRows.filter(r => r[4] === 'P').map(r => r[0]));
          const cities = rows.filter(r => formalIds.has(r[0]) && r[6] === municipality[6] && r[7] === municipality[7]);
          if (cities.length === 1) rows = cities;
        }
      }
      const seats = rows.filter(r => /^(PPLC|PPLA[2-5]?)$/.test(r[5]));
      if (seats.length) rows = seats;
      // For an explicit Chinese city, distinguish municipal/prefecture seats
      // from same-name county/township seats. Province/alias constraints already
      // apply; competing cities stay ambiguous, and lower seats remain usable
      // when there is no matching city (including county-level cities).
      if (query.country === 'CN') {
        const cities = rows.filter(r => /^(PPLC|PPLA|PPLA2)$/.test(r[5]));
        if (cities.length) rows = cities;
      }
      // A municipality and its nearby district seat can share the city's alias.
      // Prefer the parent only with matching jurisdiction codes and proximity;
      // unrelated cities, peers, and missing hierarchy evidence remain ambiguous.
      const parents = rows.filter(r => r[5] === 'PPLA2' && r[6] && r[7]);
      const parent = parents.length === 1 ? parents[0]! : undefined;
      if (parent && rows.every(r => r[0] === parent[0] || (
        /^PPLA[3-5]$/.test(r[5]) && r[8] === parent[8] && r[6] === parent[6] && r[7] === parent[7]
        && distance([parent[2], parent[3]], [r[2], r[3]]) <= 25
      ))) rows = [parent];
    }
    if (rows.length === 1) add(query, rows[0]!);
    else deferred.push({ query, rows });
  }
  // Only unambiguous first-pass matches in the same country are anchors.
  const anchors = [...places];
  for (const { query, rows } of deferred) {
    const nearby = anchors.filter(p => p.countryCode === query.country);
    const ranked = nearby.length ? rows.map(r => ({ r, d: Math.min(...nearby.map(a => distance(a.coordinates, [r[2], r[3]]))) })).sort((a, b) => a.d - b.d) : [];
    const nearest = ranked[0];
    if (nearest && nearest.d <= 50 && ranked[1] && ranked[1].d - nearest.d >= 25) add(query, nearest.r);
    else unresolved.push(query.name);
  }
  return { places, unresolved: [...new Set(unresolved)] };
}
