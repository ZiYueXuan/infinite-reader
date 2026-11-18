import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { extractBibliography, addCopyrightIdentifiers, normalizeIsbn } from '../src/pipeline/bibliography';
import { parseEpub } from '../src/pipeline/epub';
import { handleIndexMessage, indexQueueHandler } from '../src/pipeline';
import { Client, buildEpub, makeEnv, resetDb } from './helpers';

const opf = (fields: string) => `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">${fields}</metadata></package>`;
const extract = (fields: string) => extractBibliography(opf(fields), 'OEBPS/content.opf');
function fixture() {
  const files = unzipSync(buildEpub());
  files['OEBPS/content.opf'] = strToU8(strFromU8(files['OEBPS/content.opf']!).replace('</metadata>', `
    <dc:identifier id="uid" opf:scheme="ISBN">0-306-40615-2</dc:identifier>
    <dc:publisher>Science Press</dc:publisher><dc:date>1980</dc:date>
    <dc:contributor opf:role="trl">译者甲</dc:contributor></metadata>`));
  return zipSync(files);
}

describe('ISBN normalization', () => {
  it.each([
    ['0-306-40615-2', '9780306406157'], ['ISBN-10: 702004249X', '9787020042494'],
    ['urn:isbn:9787505715660', '9787505715660'], ['ISBN：９７８－７５０５７１５６６０', '9787505715660'],
    ['9791234567896', '9791234567896'], ['9787505715661', null], ['1234567890128', null],
    ['0-306-40615-3', null], ['978750571566', null], ['uuid:9787505715660', null],
  ])('validates %s without guessing', (raw, normalized) => expect(normalizeIsbn(raw!)).toBe(normalized));
});

describe('bibliographic evidence', () => {
  it('preserves leading zeroes, all ISBNs and sources, UUID and invalid identifiers', () => {
    const b = extract(`<dc:identifier id="uid">0306406152</dc:identifier>
      <dc:identifier opf:scheme="UUID">9787505715660</dc:identifier>
      <dc:identifier opf:scheme="ISBN">9787505715661</dc:identifier>
      <dc:source opf:scheme="ISBN">9787020042494</dc:source>`);
    expect(b.identifiers.map(i => [i.raw, i.normalized, i.valid, i.relation, i.primary])).toEqual([
      ['0306406152', '9780306406157', true, 'publication', true],
      ['9787505715660', null, null, 'publication', false],
      ['9787505715661', null, false, 'publication', false],
      ['9787020042494', '9787020042494', true, 'source', false],
    ]);
    expect(b.warnings).toContain('invalid_isbn');
    expect(b.identifiers[0]!.source).toEqual({ kind: 'opf', path: 'OEBPS/content.opf', field: 'dc:identifier', index: 0 });
  });

  it('supports EPUB 2 contributor roles, multiple authors and unassigned contributors', () => {
    const b = extract(`<dc:creator opf:file-as="Author, Ada">Ada Author</dc:creator>
      <dc:creator opf:role="aut">第二作者</dc:creator><dc:creator opf:role="trl">译者甲</dc:creator>
      <dc:contributor>编辑乙</dc:contributor>`);
    expect(b.contributors.map(c => [c.name, c.roles, c.sortAs])).toEqual([
      ['Ada Author', ['aut'], 'Author, Ada'], ['第二作者', ['aut'], null], ['译者甲', ['trl'], null], ['编辑乙', [], null],
    ]);
  });

  it('supports EPUB 3 refinements regardless of order, retaining publisher/date/rights/extensions', () => {
    const b = extract(`<meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
      <meta refines="#translator" property="file-as">Translator, A</meta><dc:contributor id="translator">A Translator</dc:contributor>
      <dc:title id="t">书名</dc:title><meta refines="#t" property="title-type">main</meta><dc:title>副标题</dc:title>
      <dc:identifier id="uid">9787505715660</dc:identifier><meta refines="#uid" property="identifier-type" scheme="onix:codelist5">15</meta>
      <dc:publisher>甲出版社</dc:publisher><dc:publisher>乙品牌</dc:publisher><dc:date opf:event="publication">2000-9</dc:date>
      <meta property="dcterms:modified">2026-10-30T00:00:00Z</meta><meta property="prism:edition">第二版</meta>
      <meta name="calibre:series" content="某丛书"/><dc:language>zh-CN</dc:language><dc:description>简介 &amp; 摘要</dc:description>
      <dc:rights>All rights reserved</dc:rights><dc:subject>文学</dc:subject>`);
    expect(b.contributors[0]).toMatchObject({ name: 'A Translator', roles: ['trl'], sortAs: 'Translator, A' });
    expect(b.titles.map(t => [t.value, t.type])).toEqual([['书名', 'main'], ['副标题', undefined]]);
    expect(b.publishers.map(x => x.value)).toEqual(['甲出版社', '乙品牌']);
    expect(b.dates.map(x => [x.value, x.type])).toEqual(expect.arrayContaining([['2000-9', 'publication'], ['2026-10-30T00:00:00Z', 'dcterms:modified']]));
    expect(b.descriptions[0]!.value).toBe('简介 & 摘要');
    expect(b.identifiers[0]).toMatchObject({ valid: true, scheme: 'ISBN' });
    expect(b.editions[0]!.value).toBe('第二版');
    expect(b.rights[0]!.value).toBe('All rights reserved');
    expect(b.raw.some(x => x.attributes.name === 'calibre:series' && x.attributes.content === '某丛书')).toBe(true);
  });

  it('keeps missing values empty and bounds unusual metadata with explicit warnings', () => {
    expect(extract('').identifiers).toEqual([]);
    const b = extract(`<dc:description>${'x'.repeat(5000)}</dc:description>${'<dc:title>t</dc:title>'.repeat(300)}`);
    expect(b.descriptions[0]!.value).toHaveLength(4096);
    expect(b.raw).toHaveLength(256);
    expect(b.warnings).toEqual(expect.arrayContaining(['metadata_value_truncated', 'metadata_fields_truncated']));
  });

  it('uses labelled copyright evidence without scanning ISBNs in prose or references', () => {
    const b = extract('<dc:publisher>OPF Publisher</dc:publisher>');
    addCopyrightIdentifiers(b, [
      { href: 'references.xhtml', title: '参考文献', text: '出版社：别人的出版社\nISBN 9787505715660' },
      { href: 'chapter.xhtml', title: '关于版权的问题', text: '正文讨论知识产权。ISBN 9787505715660' },
      { href: 'copyright.xhtml', title: '版权信息', text: '书名：本书\n出版社：版权页出版社\n译者：甲\n版次：第二版\n出版日期：2025年8月\nISBN：９７８－７０２００４２４９４' },
    ]);
    expect(b.identifiers).toHaveLength(1);
    expect(b.identifiers[0]).toMatchObject({ raw: 'ISBN：９７８－７０２００４２４９４', normalized: '9787020042494', relation: 'unknown', source: { kind: 'copyright-page', path: 'copyright.xhtml' } });
    expect(b.publishers.map(x => x.value)).toEqual(['OPF Publisher', '版权页出版社']);
    expect(b.contributors[0]).toMatchObject({ name: '甲', roles: ['trl'] });
    expect(b.editions[0]!.value).toBe('第二版');
  });

  it('does not change chapter text, toc or legacy display fields', () => {
    const before = parseEpub(buildEpub());
    const after = parseEpub(fixture());
    expect(after.chapters).toEqual(before.chapters);
    expect(after.toc).toEqual(before.toc);
    expect(after.title).toBe(before.title);
    expect(after.author).toBe(before.author);
    expect(after.bibliography.identifiers[0]!.normalized).toBe('9780306406157');
  });
});

describe('metadata storage and safe backfill', () => {
  beforeEach(resetDb);
  async function setup() {
    const te = makeEnv(), c = new Client(te);
    await c.login();
    const form = new FormData();
    form.set('file', new File([fixture()], 'book.epub'));
    const { book } = await (await c.fetch('/api/books', { method: 'POST', body: form })).json() as any;
    return { te, c, id: book.id as string };
  }
  const metadata = async (c: Client, id: string) => (await (await c.fetch(`/api/books/${id}/metadata`)).json()) as any;

  it('persists metadata on upload, exposes it only to owner, and reuses stored evidence', async () => {
    const { te, c, id } = await setup();
    const m = await metadata(c, id);
    expect(m.status).toBe('ready');
    expect(m.bibliography.identifiers[0].normalized).toBe('9780306406157');
    expect(m.bibliography.publishers[0].value).toBe('Science Press');
    const detail = await (await c.fetch(`/api/books/${id}`)).json() as any;
    expect(detail.book.bibliography).toEqual(m.bibliography);
    const before = await env.DB.prepare('SELECT COUNT(*) n FROM ai_usage').first();
    expect((await c.fetch(`/api/books/${id}/metadata`, { method: 'POST' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM ai_usage').first()).toEqual(before);
    const other = new Client(te); await other.login('other@example.com');
    expect((await other.fetch(`/api/books/${id}/metadata`)).status).toBe(404);
    expect((await other.fetch(`/api/books/${id}/metadata`, { method: 'POST' })).status).toBe(404);
    expect((await new Client(te).fetch(`/api/books/${id}/metadata`)).status).toBe(401);
  });

  it('backfills old books when opened without changing display names, content, progress or AI usage', async () => {
    const { te, c, id } = await setup();
    await c.fetch(`/api/books/${id}`, { method: 'PATCH', json: { title: 'My title', author: 'My author' } });
    await env.DB.prepare("UPDATE books SET bibliography = NULL, bibliography_attempted_at = NULL, state = '{\"zoom\":1.5}', progress = '{\"percent\":42}' WHERE id = ?").bind(id).run();
    const before = await env.DB.prepare('SELECT title, author, status, progress, state, updated_at FROM books WHERE id = ?').bind(id).first();
    const chunks = await env.DB.prepare('SELECT * FROM chunks WHERE book_id = ? ORDER BY ordinal').bind(id).all();
    const usage = await env.DB.prepare('SELECT COUNT(*) n FROM ai_usage').first();
    const vectors = te.vectorize.store.size;
    expect((await c.fetch(`/api/books/${id}/file`)).status).toBe(200);
    expect((await metadata(c, id)).status).toBe('ready');
    expect(await env.DB.prepare('SELECT title, author, status, progress, state, updated_at FROM books WHERE id = ?').bind(id).first()).toEqual(before);
    expect((await env.DB.prepare('SELECT * FROM chunks WHERE book_id = ? ORDER BY ordinal').bind(id).all()).results).toEqual(chunks.results);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM ai_usage').first()).toEqual(usage);
    expect(te.vectorize.store.size).toBe(vectors);
    const costs = await env.DB.prepare("SELECT metrics FROM cost_events WHERE action = '提取书籍出版信息'").all<{ metrics: string }>();
    expect(costs.results).toHaveLength(1);
    expect(JSON.parse(costs.results[0]!.metrics).r2B).toBe(1);
  });

  it('deduplicates pending requests and allows retry after the cooldown', async () => {
    const { te, c, id } = await setup();
    await env.DB.prepare('UPDATE books SET bibliography = NULL, bibliography_attempted_at = NULL WHERE id = ?').bind(id).run();
    let sent = 0;
    te.env.INDEX_QUEUE = { sendBatch: async () => { sent++; } } as unknown as Queue;
    await Promise.all([c.fetch(`/api/books/${id}/metadata`, { method: 'POST' }), c.fetch(`/api/books/${id}/metadata`, { method: 'POST' })]);
    expect(sent).toBe(1);
    await env.DB.prepare('UPDATE books SET bibliography_attempted_at = 1 WHERE id = ?').bind(id).run();
    await c.fetch(`/api/books/${id}/metadata`, { method: 'POST' });
    expect(sent).toBe(2);
  });

  it('does not break ready books when metadata extraction fails or the queue exhausts retries', async () => {
    const { te, c, id } = await setup();
    await env.DB.prepare("UPDATE books SET bibliography = NULL, bibliography_attempted_at = NULL, file_key = 'missing.epub' WHERE id = ?").bind(id).run();
    expect((await c.fetch(`/api/books/${id}/metadata`, { method: 'POST' })).status).toBe(202);
    expect((await metadata(c, id)).error).toBe('extraction_failed');
    let acked = false;
    await indexQueueHandler({ messages: [{ body: { type: 'metadata', bookId: id }, attempts: 5, ack: () => { acked = true; } }] } as unknown as MessageBatch<any>, te.env);
    expect(acked).toBe(true);
    expect(await env.DB.prepare('SELECT status, error FROM books WHERE id = ?').bind(id).first()).toEqual({ status: 'ready', error: null });
  });

  it('never recreates metadata for a deleted book', async () => {
    const { te, c, id } = await setup();
    await c.fetch(`/api/books/${id}`, { method: 'DELETE' });
    await handleIndexMessage(te.env, { type: 'metadata', bookId: id });
    expect(await env.DB.prepare('SELECT id FROM books WHERE id = ?').bind(id).first()).toBeNull();
  });
});
