import assert from 'node:assert/strict'
import test from 'node:test'
import { addNoteTags, normalizeNoteTag, noteTagsFromAnchor, removeNoteTag, replaceNoteTag, sanitizeNoteTags, NOTE_TAG_LIMIT } from './noteTags.ts'

test('tags trim hashes and whitespace and keep Chinese', () => {
  assert.equal(normalizeNoteTag('  #神话  '), '神话')
  assert.equal(normalizeNoteTag('＃悲剧'), '悲剧')
  assert.equal(normalizeNoteTag('#plot hole'), 'plot hole')
  assert.equal(normalizeNoteTag('###'), null)
  assert.equal(normalizeNoteTag('   '), null)
})

test('a note keeps at most five unique tags', () => {
  const tags = sanitizeNoteTags(['Myth', 'myth', '#悲剧', '', 'one', 'two', 'three', 'four'])
  assert.deepEqual(tags, ['Myth', '悲剧', 'one', 'two', 'three'])
  assert.equal(tags.length, NOTE_TAG_LIMIT)
  assert.equal(addNoteTags(tags, 'extra'), tags)
  assert.deepEqual(addNoteTags(tags.slice(0, 4), 'extra, leftover'), ['Myth', '悲剧', 'one', 'two', 'extra'])
})

test('tags can be edited and deleted', () => {
  const tags = ['myth', '悲剧']
  assert.deepEqual(replaceNoteTag(tags, 0, '#legend'), ['legend', '悲剧'])
  assert.equal(replaceNoteTag(tags, 1, '  悲剧 '), tags)
  assert.deepEqual(replaceNoteTag(tags, 1, ''), ['myth'])
  assert.deepEqual(replaceNoteTag(tags, 0, '悲剧'), ['悲剧'])
  assert.deepEqual(removeNoteTag(tags, 0), ['悲剧'])
  assert.equal(removeNoteTag(tags, 5), tags)
})

test('anchor tags round-trip and junk is dropped', () => {
  assert.deepEqual(noteTagsFromAnchor({ rot: 0, tags: ['#a', 'a', 3, 'b'] }), ['a', 'b'])
  assert.equal(noteTagsFromAnchor({ rot: 0 }), undefined)
  assert.equal(noteTagsFromAnchor(null), undefined)
})
