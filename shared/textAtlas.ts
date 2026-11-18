import type { AtlasPlace, BookMap } from './atlas'

export const TEXT_ATLAS_MAX_CHARS = 6000
export interface TextAtlasPlace extends AtlasPlace {
  source: 'GeoNames' | 'Natural Earth'
  sourceUrl: string
  featureCode: string
  countryCode?: string
  historicalAlias?: boolean
}
export interface TextAtlasResult {
  /** Stable passage-cache identity, including results with no resolved places. */
  cacheId?: string
  status: 'ready' | 'uncertain'
  map: (Omit<BookMap, 'image' | 'places'> & { places: TextAtlasPlace[] }) | null
  unresolved: string[]
  createdAt: number
  cached: boolean
  /** Book-scoped removals apply to every passage, including older cached results. */
  excludedPlaceIds?: string[]
}

export function excludeTextPlaces(result: TextAtlasResult, ids: Iterable<string>): TextAtlasResult {
  const excluded = new Set([...(result.excludedPlaceIds ?? []), ...ids])
  const places = result.map?.places.filter(p => !excluded.has(p.id)) ?? []
  return { ...result, excludedPlaceIds: [...excluded], map: result.map && places.length
    ? { ...result.map, places, ...textMapExtent(places.map(p => p.coordinates)) } : null }
}

/** Fit the shortest longitude arc, including passages spanning the date line. */
export function textMapExtent(points: [number, number][]): Pick<BookMap, 'bounds' | 'center'> {
  const xs = points.map(p => (p[0] + 360) % 360).sort((a, b) => a - b);
  let gap = -1, start = 0;
  for (let i = 0; i < xs.length; i++) {
    const next = (i + 1) % xs.length, distance = xs[next]! + (next === 0 ? 360 : 0) - xs[i]!;
    if (distance > gap) { gap = distance; start = next; }
  }
  const wrap = (x: number) => ((x + 180) % 360 + 360) % 360 - 180;
  const west = wrap(xs[start]!), east = west + 360 - gap;
  const ys = points.map(p => Math.max(-85, Math.min(85, p[1])));
  const south = Math.min(...ys), north = Math.max(...ys);
  const dx = Math.max(.08, (east - west) * .15), dy = Math.max(.06, (north - south) * .15);
  const left = wrap(west - dx), width = Math.min(359.99, east - west + 2 * dx);
  return { bounds: [[left, Math.max(-85, south - dy)], [left + width, Math.min(85, north + dy)]], center: [wrap((west + east) / 2), (south + north) / 2] };
}


/** Saved passage results are the source of truth; no shared read/modify/write can lose a place. */
export function mergeTextMaps(results: TextAtlasResult[], excludedPlaceIds: string[] = []): TextAtlasResult | null {
  const excluded = new Set([...excludedPlaceIds, ...results.flatMap(r => r.excludedPlaceIds ?? [])])
  const latest = new Map<string, TextAtlasResult>()
  for (const result of results) {
    const id = result.cacheId ?? result.map?.id
    if (id && (!latest.has(id) || result.createdAt >= latest.get(id)!.createdAt)) latest.set(id, result)
  }
  const ready = [...latest.values()].filter(r => r.status === 'ready' && r.map?.places.length)
    .sort((a, b) => a.createdAt - b.createdAt || a.map!.id.localeCompare(b.map!.id))
  const places = new Map<string, TextAtlasPlace>()
  for (const result of ready) for (const place of result.map!.places) if (!excluded.has(place.id)) places.set(place.id, place)
  if (!places.size) return null
  const all = [...places.values()]
  return {
    status: 'ready', cached: true, createdAt: ready[ready.length - 1]!.createdAt, unresolved: [], excludedPlaceIds: [...excluded],
    map: { id: 'text-book', title: '文字地点汇总', period: '', number: '', places: all,
      ...textMapExtent(all.map(p => p.coordinates)) },
  }
}
