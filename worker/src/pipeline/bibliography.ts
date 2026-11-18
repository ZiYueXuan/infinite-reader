import { XMLParser } from 'fast-xml-parser';
import type { BookBibliography, BookIdentifier, MetadataSource } from '../../../shared/bibliography';

// Do not coerce identifiers to numbers: leading zeroes in ISBN-10 are significant.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_',
  parseTagValue: false, parseAttributeValue: false, trimValues: false });
const array = (v: unknown): unknown[] => v == null ? [] : Array.isArray(v) ? v : [v];
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const local = (s: string) => s.split(':').at(-1)!;
const valueOf = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'number' ? String(v) :
  Object.entries(object(v)).filter(([k]) => !k.startsWith('@_')).map(([, n]) => array(n).map(valueOf).join(' ')).join(' ');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A structurally valid ISBN does not establish that it belongs to this book. */
export function normalizeIsbn(raw: string): string | null {
  const n = raw.normalize('NFKC').toUpperCase().replace(/^(?:URN:)?ISBN(?:-1[03])?\s*:?\s*/i, '').replace(/[\s\-‐‑–—]/g, '');
  if (/^\d{9}[\dX]$/.test(n)) {
    const sum = [...n].reduce((s, c, i) => s + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    if (sum % 11) return null;
    const base = `978${n.slice(0, 9)}`;
    const check = (10 - [...base].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10) % 10;
    return base + check;
  }
  if (!/^97[89]\d{10}$/.test(n)) return null;
  return [...n].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0 ? n : null;
}

function identifier(raw: string, scheme: string | null, source: MetadataSource,
  relation: BookIdentifier['relation'], primary = false): BookIdentifier {
  const inferred = /^(?:urn:)?isbn(?:-1[03])?\s*:?/i.test(raw.trim()) || /^[\dXx\s\-‐‑–—]{10,30}$/.test(raw.normalize('NFKC').trim());
  const isIsbn = scheme ? /^(?:isbn(?:-?1[03])?|02|15)$/i.test(scheme) : inferred;
  return { raw, scheme: isIsbn ? 'ISBN' : scheme, normalized: isIsbn ? normalizeIsbn(raw) : null,
    valid: isIsbn ? normalizeIsbn(raw) !== null : null, source, relation, primary };
}

export function extractBibliography(opf: string, path: string): BookBibliography {
  const doc = object(parser.parse(opf));
  const pkg = object(Object.entries(doc).find(([k]) => local(k) === 'package')?.[1]);
  const md = object(Object.entries(pkg).find(([k]) => local(k) === 'metadata')?.[1]);
  const b: BookBibliography = { schemaVersion: 1, extractorVersion: 1, format: 'epub', extractedAt: Date.now(),
    titles: [], contributors: [], publishers: [], dates: [], languages: [], descriptions: [], subjects: [], rights: [],
    editions: [], identifiers: [], raw: [], warnings: [] };
  const warn = (s: string) => { if (!b.warnings.includes(s)) b.warnings.push(s); };
  const bounded = (s: string) => { if (s.length > 4096) warn('metadata_value_truncated'); return s.slice(0, 4096); };
  let budget = 64_000;
  for (const [field, nodes] of Object.entries(md)) {
    if (field.startsWith('@_')) continue;
    for (const [index, node] of array(nodes).entries()) {
      if (b.raw.length >= 256 || budget <= 0) { warn('metadata_fields_truncated'); break; }
      const attributes: Record<string, string> = {};
      const attrs = Object.entries(object(node)).filter(([k]) => k.startsWith('@_'));
      if (attrs.length > 16) warn('metadata_attributes_truncated');
      for (const [k, v] of attrs.slice(0, 16)) attributes[k.slice(2)] = bounded(String(v)).slice(0, 512);
      const value = bounded(valueOf(node));
      budget -= value.length + JSON.stringify(attributes).length + field.length;
      b.raw.push({ field, value, attributes, source: { kind: 'opf', path, field, index } });
    }
  }
  const attr = (r: typeof b.raw[number], name: string) => Object.entries(r.attributes).find(([k]) => local(k) === name)?.[1];
  const refinements = (r: typeof b.raw[number], property: string) => {
    const id = attr(r, 'id');
    return id ? b.raw.filter(m => local(m.field) === 'meta' && attr(m, 'refines') === `#${id}` && attr(m, 'property') === property).map(m => clean(m.value)) : [];
  };
  const uniqueId = String(pkg['@_unique-identifier'] ?? '');
  for (const r of b.raw) {
    const key = local(r.field), value = clean(r.value);
    if (!value && key !== 'meta') continue;
    const source = r.source;
    const v = { value, source };
    if (key === 'title') b.titles.push({ ...v, type: refinements(r, 'title-type')[0] });
    if (key === 'creator' || key === 'contributor') {
      const roles = [...refinements(r, 'role'), ...(attr(r, 'role') ? [attr(r, 'role')!] : [])];
      b.contributors.push({ name: value, source, sortAs: refinements(r, 'file-as')[0] ?? attr(r, 'file-as') ?? null,
        roles: [...new Set(roles.length ? roles : key === 'creator' ? ['aut'] : [])] });
    }
    if (key === 'publisher') b.publishers.push(v);
    if (key === 'date') b.dates.push({ ...v, type: attr(r, 'event') ?? 'unspecified' });
    if (key === 'language') b.languages.push(v);
    if (key === 'description') b.descriptions.push(v);
    if (key === 'subject') b.subjects.push(v);
    if (key === 'rights') b.rights.push(v);
    if (key === 'identifier' || key === 'source') {
      b.identifiers.push(identifier(value, attr(r, 'scheme') ?? refinements(r, 'identifier-type')[0] ?? null, source,
        key === 'source' ? 'source' : 'publication', !!uniqueId && attr(r, 'id') === uniqueId));
    }
    if (key === 'meta') {
      const property = attr(r, 'property') ?? attr(r, 'name') ?? '';
      const mv = { value: clean(attr(r, 'content') ?? value), source };
      if (!attr(r, 'refines') && mv.value) {
        if (['dcterms:issued', 'dcterms:created', 'dcterms:modified'].includes(property)) b.dates.push({ ...mv, type: property });
        if (['prism:edition', 'biblio:edition', 'edition'].includes(property)) b.editions.push(mv);
        if (/^(?:isbn|isbn13|isbn10|prism:isbn)$/i.test(property)) b.identifiers.push(identifier(mv.value, 'ISBN', source, 'unknown'));
      }
    }
  }
  if (b.identifiers.some(i => i.valid === false)) warn('invalid_isbn');
  return b;
}

/** Only labelled ISBNs on explicitly identified copyright pages. Never scan ordinary prose/references. */
export function addCopyrightIdentifiers(b: BookBibliography, chapters: { href: string; title: string; text: string }[]) {
  let pages = 0;
  for (const c of chapters) {
    const heading = clean(c.title);
    const start = c.text.slice(0, 500);
    const copyrightHeading = /^(?:版权(?:信息|页|说明|声明)?|出版说明|图书在版编目|copyright(?: page)?)(?:\s|[：:©（(]|$)/i;
    if (!copyrightHeading.test(heading) && !copyrightHeading.test(start.trimStart())) continue;
    if (!/出版社|出版发行|出版者|publisher|published by|all rights reserved|版权所有|图书在版编目/i.test(c.text.slice(0, 12000))) continue;
    if (++pages > 8) { b.warnings.push('copyright_pages_truncated'); break; }
    const text = c.text.slice(0, 12000);
    const re = /\bISBN(?:-1[03])?\s*[:：]?\s*([\d０-９Xx][\d０-９Xx \t\-－‐‑–—]{8,28}[\d０-９Xx])/gi;
    for (const m of text.matchAll(re)) {
      if (b.identifiers.length >= 64) { b.warnings.push('copyright_identifiers_truncated'); return; }
      const raw = m[0].trim();
      const item = identifier(raw, 'ISBN', { kind: 'copyright-page', path: c.href, field: 'labelled-isbn', index: m.index! }, 'unknown');
      b.identifiers.push(item);
      if (!item.valid && !b.warnings.includes('invalid_isbn')) b.warnings.push('invalid_isbn');
    }
    // Labelled values remain separate candidates. No guessing from unlabelled sentences.
    const fields = /(?:^|\n)\s*(书名|出版社|出版者|出版发行|作者|著者|译者|翻译|出版日期|出版时间|版次)\s*[:：]\s*([^\n]{1,300})/g;
    for (const m of text.matchAll(fields)) {
      const source: MetadataSource = { kind: 'copyright-page', path: c.href, field: m[1]!, index: m.index! };
      const value = clean(m[2]!);
      if (m[1] === '书名') b.titles.push({ value, source });
      else if (['出版社', '出版者', '出版发行'].includes(m[1]!)) b.publishers.push({ value, source });
      else if (['作者', '著者', '译者', '翻译'].includes(m[1]!)) b.contributors.push({ name: value, roles: [m[1] === '作者' || m[1] === '著者' ? 'aut' : 'trl'], sortAs: null, source });
      else if (m[1] === '版次') b.editions.push({ value, source });
      else b.dates.push({ value, source, type: 'publication' });
    }
  }
}
