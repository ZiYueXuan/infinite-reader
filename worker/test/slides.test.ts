import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEpub, Client, makeEnv, mockFetch, resetDb } from './helpers';
import { chapterIndices, chapterEndIndex } from '../../shared/chapters';
import { slidesSource, splitChapter } from '../src/slides/source';
import { parseSlides, parseSummary } from '../src/slides/generate';
import { handleSlidesMessage, key, prefix, readJob, messageFor, STALE_AFTER, type SlidesMessage } from '../src/slides/jobs';
import type { SlidesState } from '../../shared/slides';
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
const slide = { layout: 'overview', title: 'Ideas that connect', takeaway: 'A chapter has a beginning and an ending.', items: [{ heading: 'Evidence', text: 'The entire chapter is considered.' }] };
function archive(long = false) {
  const files = unzipSync(buildEpub());
  files['OEBPS/nav.xhtml'] = strToU8('<html><body><nav><ol><li><a href="text/ch1.xhtml">Chapter One</a><ol><li><a href="text/ch1.xhtml#s1">Section 1</a></li></ol></li><li><a href="text/ch2.xhtml">Chapter Two</a></li></ol></nav></body></html>');
  files['OEBPS/text/ch1.xhtml'] = strToU8(`<html><body><h1>Chapter One</h1><p>START of chapter one.</p><h2 id="s1">Section 1</h2><p>${'Whole chapter content. '.repeat(long ? 1300 : 10)}</p><p>END OF CHAPTER ONE</p></body></html>`);
  return zipSync(files);
}
async function setup(long = false) {
  const te = makeEnv(), client = new Client(te), { user } = await client.login();
  const form = new FormData(); form.set('file', new File([archive(long)], 'chapters.epub'));
  const { book } = await (await client.fetch('/api/books', { method: 'POST', body: form })).json() as any;
  const messages: SlidesMessage[] = [];
  Object.assign(te.env, { INDEX_QUEUE: { send: vi.fn(async (m: SlidesMessage) => { messages.push(m); }) } });
  const target = 'OEBPS/text/ch1.xhtml', endpoint = `/api/books/${book.id}/slides`;
  const post = (retry = false, t = target) => client.fetch(endpoint, { method: 'POST', json: { target: t, retry } });
  const get = async () => await (await client.fetch(`${endpoint}?target=${encodeURIComponent(target)}`)).json() as SlidesState;
  const step = async () => { const m = messages.shift()!; expect(m).toBeTruthy(); await handleSlidesMessage(te.env, m); return m; };
  const drain = async () => { for (let i = 0; messages.length && i < 30; i++) await step(); expect(messages).toHaveLength(0); };
  const job = async () => (await readJob(te.env, book.id, user.id, target))!;
  return { te, client, user, book, target, endpoint, messages, post, get, step, drain, job };
}
const completion = (value: unknown) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
function model() {
  return mockFetch({ 'https://llm.test/chat/completions': async req => {
    const body = await req.clone().json() as any, source = JSON.parse(body.messages[1].content);
    const summary = body.messages[0].content.includes('Summarize this contiguous part');
    return Response.json(completion(summary ? { summary: source.text.includes('END OF CHAPTER ONE') ? 'The ending matters.' : 'The beginning matters.' } : { slides: [slide] }));
  } });
}
describe('chapter selection and slide validation', () => {
  it('accepts modest summary overruns intact while keeping a strict size and structure bound', () => {
    for (const length of [2400, 2491, 3200]) {
      const summary = '史'.repeat(length - 4) + '最后结论';
      expect(parseSummary(JSON.stringify({ summary }))).toBe(summary);
    }
    for (const value of [{ summary: '史'.repeat(3201) }, { summary: '' }, { summary: ['Not prose'] }, { summary: 'Valid', extra: true }]) {
      expect(() => parseSummary(JSON.stringify(value))).toThrow();
    }
    expect(() => parseSummary('{"summary":')).toThrow();
  });
  it('offers chapters, never sections, front matter or parts', () => {
    const toc = ['前言', '第一部', '第一章', '第一节', '背景', '第二章', '1.1 细节', '附录'].map((title, i) => ({ title, level: i === 4 ? 2 : 0 }));
    expect(chapterIndices(toc)).toEqual([2, 5]); expect(chapterEndIndex(toc, 2)).toBe(5);
    expect(chapterIndices([{ title: 'Part I', level: 0 }, { title: 'Origins', level: 1 }, { title: 'Detail', level: 2 }, { title: 'Outcomes', level: 1 }, { title: 'Section 5', level: 0 }])).toEqual([1, 3]);
    expect(chapterIndices([{ title: 'Section 1', level: 0 }])).toEqual([]);
  });
  it.each(['序章', '序 章', '序　章', '序章：故事的开始', 'Prologue'])('includes %s beside numbered chapters, without treating its sections as chapters', title => {
    const toc = ['前言', title, '第一节 背景', '第一章', '第二章', '附录'].map(title => ({ title, level: 0 }));
    expect(chapterIndices(toc)).toEqual([1, 3, 4]);
    expect(chapterEndIndex(toc, 1)).toBe(3);
  });
  it('keeps unnumbered chapters eligible when a prologue is present', () => {
    expect(chapterIndices([
      { title: '前言', level: 0 }, { title: '序 章', level: 0 }, { title: '第一节 背景', level: 1 },
      { title: '远行', level: 0 }, { title: '重逢', level: 0 }, { title: '后记', level: 0 },
    ])).toEqual([1, 3, 4]);
  });
  it('extracts the full prologue including its sections and stops before chapter one', () => {
    const files = unzipSync(archive());
    files['OEBPS/nav.xhtml'] = strToU8('<html><body><nav><ol><li><a href="text/ch1.xhtml">序 章</a><ol><li><a href="text/ch1.xhtml#s1">第一节 背景</a></li></ol></li><li><a href="text/ch2.xhtml">第一章</a></li></ol></nav></body></html>');
    files['OEBPS/text/ch1.xhtml'] = strToU8('<html><body><h1>序 章</h1><p>Opening of the prologue, before the numbered chapters.</p><h2 id="s1">第一节 背景</h2><p>The final paragraph of the prologue.</p></body></html>');
    files['OEBPS/text/ch2.xhtml'] = strToU8('<html><body><h1>第一章</h1><p>Numbered chapter prose must stay separate.</p></body></html>');
    const source = slidesSource(zipSync(files), 'OEBPS/text/ch1.xhtml');
    expect(source.title).toBe('序 章');
    expect(source.parts.join('')).toContain('Opening of the prologue');
    expect(source.parts.join('')).toContain('The final paragraph of the prologue.');
    expect(source.parts.join('')).not.toContain('Numbered chapter prose');
    expect(() => slidesSource(zipSync(files), 'OEBPS/text/ch1.xhtml#s1')).toThrow('chapters only');
  });
  it('extracts every subsection and stops at the next chapter', () => {
    const source = slidesSource(archive(), 'OEBPS/text/ch1.xhtml');
    expect(source.parts.join('')).toContain('END OF CHAPTER ONE');
    expect(source.parts.join('')).toContain('Section 1');
    expect(source.parts.join('')).not.toContain('volcanoes');
    expect(() => slidesSource(archive(), 'OEBPS/text/ch1.xhtml#s1')).toThrow('chapters only');
  });
  it('repairs a uniquely identified numbered heading when the navigation points elsewhere', () => {
    const files = unzipSync(archive());
    files['OEBPS/nav.xhtml'] = strToU8('<html><body><nav><ol><li><a href="text/ch2.xhtml">Chapter One</a></li><li><a href="text/ch2.xhtml">Copyright</a></li><li><a href="text/ch2.xhtml#next">Chapter Two</a></li></ol></nav></body></html>');
    files['OEBPS/text/ch2.xhtml'] = strToU8('<html><body><h1 id="next">Chapter Two</h1><p>This must not appear in the first chapter.</p></body></html>');
    const source = slidesSource(zipSync(files), 'OEBPS/text/ch2.xhtml');
    expect(source.title).toBe('Chapter One'); expect(source.parts.join('')).toContain('END OF CHAPTER ONE'); expect(source.parts.join('')).not.toContain('must not appear');
  });
  it('does not attach a volume’s endnotes or repeated navigation to its last chapter', () => {
    const files = unzipSync(archive());
    files['OEBPS/text/ch1.xhtml'] = strToU8('<html><body><h1>Chapter One</h1><p>Substantive chapter prose with enough text to generate useful slides.</p><p>[<a href="#old">←1</a>]</p><p>Unrelated reference from another chapter</p></body></html>');
    const source = slidesSource(zipSync(files), 'OEBPS/text/ch1.xhtml');
    expect(source.parts.join('')).toContain('Substantive chapter prose');
    expect(source.parts.join('')).not.toContain('Unrelated reference');
  });
  it('covers long text without dropping characters and validates 1–10 total pages', () => {
    const text = ('段落🙂\n').repeat(20000), parts = splitChapter(text);
    expect(parts.join('')).toBe(text); expect(parts.every(p => p.length <= 24000)).toBe(true);
    expect(parseSlides(JSON.stringify({ slides: [slide] }))).toHaveLength(1);
    expect(parseSlides(JSON.stringify({ slides: Array(10).fill(slide) }))).toHaveLength(10);
    for (const slides of [[], Array(11).fill(slide), [{ ...slide, layout: 'script' }], [{ ...slide, items: Array(5).fill(slide.items[0]) }]]) expect(() => parseSlides(JSON.stringify({ slides }))).toThrow();
  });
});
describe('durable HTML slide jobs', () => {
  it('admits once across concurrent clicks, duplicate deliveries and later opens; meters usage', async () => {
    const s = await setup(), mocked = model();
    const responses = await Promise.all([s.post(), s.post()]);
    expect(responses.map(r => r.status)).toEqual([200, 200]); expect(s.messages).toHaveLength(1);
    await s.step(); const m = s.messages.shift()!;
    await Promise.all([handleSlidesMessage(s.te.env, m), handleSlidesMessage(s.te.env, m)]);
    expect(mocked.calls).toHaveLength(1); expect(await s.get()).toMatchObject({ status: 'ready', result: { slides: [slide] } });
    await s.post(true); await handleSlidesMessage(s.te.env, m); expect(mocked.calls).toHaveLength(1);
    expect(await s.te.env.DB.prepare("SELECT status, output_tokens FROM ai_usage WHERE feature = 'chapter_slides'").first()).toMatchObject({ status: 'succeeded', output_tokens: 50 });
    const index = await s.client.fetch(`/api/books/${s.book.id}/slides-index`); expect(await index.json()).toEqual({ readyTargets: [s.target] });
  });
  it('summarizes every part of a long chapter before synthesizing, independent of an open browser', async () => {
    const s = await setup(true), mocked = model(); await s.post(); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'ready', completed: 3, total: 3 });
    expect(mocked.calls).toHaveLength(3);
    const last = await mocked.calls.at(-1)!.clone().json() as any;
    expect(last.messages[1].content).toContain('The beginning matters.'); expect(last.messages[1].content).toContain('The ending matters.');
  });
  it('rejects forged subsection targets without any inference', async () => {
    const s = await setup(), mocked = model(); await s.post(false, `${s.target}#s1`); await s.drain();
    const state = await s.client.fetch(`${s.endpoint}?target=${encodeURIComponent(s.target + '#s1')}`);
    expect(await state.json()).toMatchObject({ status: 'failed', errorCode: 'slides_not_chapter' }); expect(mocked.calls).toHaveLength(0);
  });
  it('requires ownership, never exposes another reader’s slides, and cleans caches on deletion', async () => {
    const s = await setup(); model(); await s.post(); await s.drain();
    const other = new Client(s.te); await other.login('other@example.com');
    expect((await other.fetch(`${s.endpoint}?target=${s.target}`)).status).toBe(404);
    expect((await other.fetch(s.endpoint, { method: 'POST', json: { target: s.target } })).status).toBe(404);
    expect((await other.fetch(`/api/books/${s.book.id}/slides-index`)).status).toBe(404);
    expect((await s.client.fetch(`/api/books/${s.book.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await s.te.env.BOOKS.list({ prefix: prefix(s.user.id, s.book.id) })).objects).toHaveLength(0);
    expect(await s.job()).toBeNull();
  });
  it('preserves completed summaries on explicit retry of a failed model call', async () => {
    const s = await setup(true); let calls = 0;
    mockFetch({ 'https://llm.test/chat/completions': async () => { calls++; return calls === 2 ? new Response('provider unavailable', { status: 503 }) : Response.json(completion(calls < 4 ? { summary: 'Saved summary' } : { slides: [slide] })); } });
    await s.post(); await s.drain(); expect(await s.get()).toMatchObject({ status: 'failed', completed: 1 });
    await s.post(); expect(s.messages).toHaveLength(0);
    await s.post(true); await s.drain(); expect(calls).toBe(4); expect(await s.get()).toMatchObject({ status: 'ready' });
  });
  it('recovers a valid paid checkpoint without calling the provider again', async () => {
    const s = await setup(), mocked = model(); await s.post(); await s.step(); const job = await s.job();
    await s.te.env.BOOKS.put(key(job, 'raw/0'), JSON.stringify(JSON.stringify({ slides: [slide] })));
    await s.te.env.DB.prepare("UPDATE chapter_slides SET part_started_at = ?").bind(Date.now()).run();
    await s.drain(); expect(mocked.calls).toHaveLength(0); expect(await s.get()).toMatchObject({ status: 'ready' });
  });
  it('resumes a previously rejected 2491-character summary without paying for it again', async () => {
    const s = await setup(true), mocked = model();
    await s.post(); await s.step(); await s.step();
    const job = await s.job(), summary = '史'.repeat(2487) + '最后结论';
    expect(job.completed_parts).toBe(1);
    await s.te.env.BOOKS.put(key(job, 'raw/1'), JSON.stringify(JSON.stringify({ summary })));
    await s.te.env.DB.prepare("UPDATE chapter_slides SET status = 'failed', error_code = 'slides_invalid', part_started_at = ?").bind(Date.now()).run();
    s.messages.length = 0;
    await Promise.all([s.post(true), s.post(true)]); await s.drain();
    expect(await s.get()).toMatchObject({ status: 'ready', completed: 3, total: 3 });
    expect(mocked.calls).toHaveLength(2); // First summary and synthesis; second summary is reused.
    const synthesis = await mocked.calls.at(-1)!.clone().json() as any;
    expect(JSON.parse(synthesis.messages[1].content).text).toContain(summary);
  });
  it('keeps uncertain provider calls locked instead of charging again on queue retry', async () => {
    const s = await setup(), mocked = model(); await s.post(); await s.step();
    await s.te.env.DB.prepare('UPDATE chapter_slides SET part_started_at = ?, updated_at = ?').bind(Date.now(), Date.now() - STALE_AFTER - 1).run();
    await s.drain(); expect(await s.get()).toMatchObject({ status: 'interrupted' });
    await s.post(true); expect(mocked.calls).toHaveLength(0); expect(s.messages).toHaveLength(0);
  });
  it('retries rejected output only explicitly and never repeats already valid checkpoints', async () => {
    const s = await setup(); let calls = 0;
    mockFetch({ 'https://llm.test/chat/completions': async () => Response.json(completion(++calls === 1 ? { slides: [] } : { slides: [slide] })) });
    await s.post(); await s.drain(); expect(await s.get()).toMatchObject({ status: 'failed', errorCode: 'slides_invalid' });
    expect(await s.te.env.BOOKS.get(key(await s.job(), 'raw/0'))).not.toBeNull();
    await s.post(); expect(calls).toBe(1);
    await Promise.all([s.post(true), s.post(true)]); await s.drain();
    expect(calls).toBe(2); expect(await s.get()).toMatchObject({ status: 'ready' });
    // The R2 result is authoritative even if the final D1 write was lost.
    await s.te.env.DB.prepare("UPDATE chapter_slides SET status = 'running'").run();
    expect(await s.get()).toMatchObject({ status: 'ready' }); await s.post(true); expect(calls).toBe(2);
  });
  it('removes outputs that race with book deletion during inference', async () => {
    const s = await setup();
    mockFetch({ 'https://llm.test/chat/completions': async () => {
      await s.client.fetch(`/api/books/${s.book.id}`, { method: 'DELETE' });
      return Response.json(completion({ slides: [slide] }));
    } });
    await s.post(); await s.drain();
    expect((await s.te.env.BOOKS.list({ prefix: prefix(s.user.id, s.book.id) })).objects).toHaveLength(0);
    expect(await s.job()).toBeNull();
  });
  it('ignores queued work after deletion', async () => {
    const s = await setup(), mocked = model(); await s.post(); const msg = messageFor(await s.job());
    await s.client.fetch(`/api/books/${s.book.id}`, { method: 'DELETE' }); await handleSlidesMessage(s.te.env, msg); expect(mocked.calls).toHaveLength(0);
  });
});
