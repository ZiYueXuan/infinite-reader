import assert from 'node:assert/strict'
import test from 'node:test'
import { annotationSignature, noteTextColorOf, type Annotation } from '../book/annotations.ts'
import { noteTagsFromAnchor, noteWireAnchor } from '../book/noteTags.ts'

const ann = (tags?: string[]): Annotation => ({
  id: 'abcd1234wxyz',
  bookId: 'book',
  locator: { chapter: 1, start: 0, end: 4 },
  quote: 'text',
  kind: 'highlight',
  color: 'pink',
  note: { text: '法厄同的悲剧', x: 1.234, y: -2, rot: 0.02, ...(tags ? { tags } : {}) },
  createdAt: 1,
  updatedAt: 2,
})

test('note tags travel in the note anchor and survive a reload mapping', () => {
  const note = ann(['神话', 'tragedy']).note!
  const anchor = noteWireAnchor(note, ann().locator)
  assert.deepEqual(anchor.tags, ['神话', 'tragedy'])
  assert.deepEqual(noteTagsFromAnchor(anchor), ['神话', 'tragedy'])
})

test('notes without tags keep the previous anchor shape', () => {
  const anchor = noteWireAnchor(ann().note!, ann().locator)
  assert.equal('tags' in anchor, false)
  assert.equal(noteTagsFromAnchor({ chapter: 1, start: 0, end: 4, rot: 0.5 }), undefined)
  assert.equal(Number(anchor.rot), 0.02)
})

test('a tag-only edit is a different sync signature', () => {
  assert.notEqual(annotationSignature(ann(['a'])), annotationSignature(ann()))
  assert.equal(annotationSignature(ann()), annotationSignature({ ...ann(), note: { ...ann().note!, tags: [] } }))
})

test('note text colour survives the wire anchor and colour-only edits are synced', () => {
  const a = ann(['标签'])
  const previous = annotationSignature(a)
  a.note!.textColor = 'blue'
  assert.notEqual(annotationSignature(a), previous)
  const anchor = noteWireAnchor(a.note!, a.locator)
  assert.equal(noteTextColorOf(anchor.textColor), 'blue')
  assert.equal(a.color, 'pink')
  a.note!.textColor = 'default'
  assert.equal('textColor' in noteWireAnchor(a.note!, a.locator), false)
  assert.equal(annotationSignature(a), previous)
  for (const raw of [undefined, null, 'not-a-colour', '__proto__', '#123456']) assert.equal(noteTextColorOf(raw), 'default')
})
