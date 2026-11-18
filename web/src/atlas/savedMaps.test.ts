import test from 'node:test'
import assert from 'node:assert/strict'
import { locateSavedMaps, mapAnchors, mergeLocatedMaps } from './savedMaps.ts'
import { BOOK_MAPS } from './catalog.ts'
import type { ParsedBook } from '../book/types.ts'

const image = new Blob(['a saved map'])
const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await image.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('')
const map = { ...BOOK_MAPS[0], image: { sha256: hash, bytes: image.size } }
function fixture() {
  const reads: string[] = []
  const book: ParsedBook = { meta: { title: 'Maps', author: '', language: 'en' }, toc: [],
    chapters: [0, 1].map(index => ({ index, href: `${index}.html`, title: `Chapter ${index}`, textLength: 2,
      blocks: [{ kind: 'img', runs: [], text: '', start: 0, img: { path: 'renamed.png', alt: '' } },
        { kind: 'img', runs: [], text: '', start: 1, img: { path: 'unrelated.png', alt: '' } }] })),
    getImage: async path => { reads.push(path); return path === 'renamed.png' ? image : new Blob(['x'.repeat(image.size)]) } }
  return { book, reads }
}
test('saved content identity finds renamed images and every occurrence, not equal-size unrelated images', async () => {
  const { book, reads } = fixture()
  const located = await locateSavedMaps(book, [map], new AbortController().signal)
  assert.deepEqual(located.map(x => [x.path, x.chapter, x.block]), [['renamed.png', 0, 0], ['renamed.png', 1, 0]])
  assert.deepEqual(reads, ['renamed.png', 'unrelated.png'])
})
test('empty catalogs do no image work and obsolete requests abort', async () => {
  const { book, reads } = fixture()
  assert.deepEqual(await locateSavedMaps(book, [], new AbortController().signal), [])
  assert.deepEqual(reads, [])
  await assert.rejects(locateSavedMaps(book, [map], AbortSignal.abort()), { name: 'AbortError' })
})
test('live recognition replaces existing map data without duplicate anchors', () => {
  const { book } = fixture()
  const before = mapAnchors(book, 'renamed.png', map)
  const updated = { ...map, title: 'Updated title' }
  const merged = mergeLocatedMaps(before, mapAnchors(book, 'renamed.png', updated))
  assert.equal(merged.length, 2)
  assert.ok(merged.every(x => x.map.title === 'Updated title'))
  assert.deepEqual(merged.map(x => x.chapter), [0, 1])
})
