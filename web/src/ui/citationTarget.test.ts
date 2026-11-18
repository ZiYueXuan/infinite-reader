import assert from 'node:assert/strict'
import test from 'node:test'
import type { Citation } from '../api/ask'
import { webSourceUrl } from '../../../shared/citations.ts'
import type { Chapter } from '../book/types'
import { citationLocator } from './citationTarget.ts'

function chapter(href: string, text: string): Chapter {
  return { index: 0, href, title: href, textLength: text.length, blocks: [{ kind: 'p', runs: [{ text }], text, start: 0 }] }
}
const source: Citation = { n: 1, chunkId: 'chunk-a', ordinal: 0, chapterIndex: 0, chapterTitle: 'Preface', chapterHref: 'OEBPS/preface.xhtml', charStart: 0, charEnd: 90, snippet: 'The Persian history begins here.', score: 0.9 }

test('external sources never navigate inside the book and accept only public web schemes', () => {
  assert.equal(citationLocator({ kind: 'web', n: 2, url: 'https://example.com', title: 'Web', snippet: '', retrievedAt: 1 }, []), null)
  assert.equal(webSourceUrl('https://example.com/article'), 'https://example.com/article')
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', '/book/fake', 'https://name:password@example.com']) assert.equal(webSourceUrl(url), null)
})

test('EPUB path wins over server chapter index shifted by image pages', () => {
  const chapters = [chapter('OEBPS/maps.xhtml', ''), chapter('OEBPS/preface.xhtml', source.snippet)]
  assert.deepEqual(citationLocator(source, chapters), { chapter: 1, start: 0, end: source.snippet.length })
  assert.equal(citationLocator({ ...source, chapterHref: 'OEBPS/missing.xhtml' }, chapters), null)
})

test('quote matching corrects whitespace offsets, including CJK and soft hyphens', () => {
  const text = '引言\n中文之间没有空格。这是被引用的原文。\n后记'
  const citation = { ...source, charStart: 50, charEnd: 90, snippet: '中文 之\n间没有空格。这是被引用的\u00ad原文。' }
  assert.deepEqual(citationLocator(citation, [chapter(source.chapterHref!, text)]), { chapter: 0, start: 3, end: text.indexOf('\n后记') })
})

test('same-chapter citations select separate repeated passages by nearest source offset', () => {
  const quote = 'A repeated passage about Persia.'
  const text = `${quote}\n${'Some other text. '.repeat(15)}\n${quote}`
  const chapters = [chapter(source.chapterHref!, text)]
  const last = text.lastIndexOf(quote)
  assert.equal(citationLocator({ ...source, snippet: quote }, chapters)?.start, 0)
  assert.equal(citationLocator({ ...source, snippet: quote, charStart: last + 5, charEnd: last + 100 }, chapters)?.start, last)
})

test('encoded chapter paths, image-only chapters, and legacy offsets remain navigable', () => {
  const chapters = [chapter('OEBPS/封面.xhtml', ''), chapter('OEBPS/text.xhtml', 'Some text in the book.')]
  assert.deepEqual(citationLocator({ ...source, chapterHref: 'OEBPS/%E5%B0%81%E9%9D%A2.xhtml#cover' }, chapters), { chapter: 0, start: 0, end: 1 })
  assert.deepEqual(citationLocator({ ...source, chapterHref: null, chapterIndex: 1, charStart: 5, charEnd: 10, snippet: '' }, chapters), { chapter: 1, start: 5, end: 10 })
  assert.equal(citationLocator({ ...source, chapterHref: null, chapterIndex: 9 }, chapters), null)
})
