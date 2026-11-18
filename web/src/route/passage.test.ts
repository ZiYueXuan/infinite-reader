import assert from 'node:assert/strict'
import test from 'node:test'
import { passageFromHash, pathForPassage, validatePassage } from './passage.ts'

test('passage links encode chapter offsets independently of page size', () => {
  const loc = { chapter: 3, start: 120, end: 680 }
  const url = pathForPassage('bk_example', loc)
  assert.equal(url, '/book/bk_example#passage=3:120:680')
  assert.deepEqual(passageFromHash(new URL(url, 'https://reader.example').hash), loc)
  assert.deepEqual(passageFromHash('#passage=0:0:1'), { chapter: 0, start: 0, end: 1 })
})

test('malformed, reversed and unsafe offsets are rejected', () => {
  for (const hash of ['', '#other=1:2:3', '#passage=-1:0:1', '#passage=1:2.5:3', '#passage=1:20:20', '#passage=1:30:20', '#passage=9007199254740992:0:1', '#passage=1:2:3junk']) {
    assert.equal(passageFromHash(hash), null, hash)
  }
})

test('links are bounded to the loaded book and never point past chapter text', () => {
  const chapters = [{ textLength: 200 }, { textLength: 0 }]
  assert.deepEqual(validatePassage({ chapter: 0, start: 50, end: 250 }, chapters), { chapter: 0, start: 50, end: 200 })
  for (const loc of [
    { chapter: -1, start: 0, end: 1 }, { chapter: 2, start: 0, end: 1 },
    { chapter: 1, start: 1, end: 2 }, { chapter: 0, start: 200, end: 220 },
    { chapter: 0, start: -1, end: 2 }, { chapter: 0, start: NaN, end: 2 },
    { chapter: 0, start: 10, end: 9 },
  ]) assert.equal(validatePassage(loc, chapters), null)
  assert.deepEqual(validatePassage({ chapter: 1, start: 0, end: 50 }, chapters), { chapter: 1, start: 0, end: 1 })
})
