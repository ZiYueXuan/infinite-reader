import assert from 'node:assert/strict'
import test from 'node:test'
import { bookIdFromPath, navForTransition, pathForBook, type ReaderNav } from './bookPath.ts'

const id = '11111111-1111-4111-8111-111111111111'
const local = 'bk_abc123'

const base = (patch: Partial<ReaderNav> = {}): ReaderNav => ({
  open: false,
  bookId: null,
  session: 'user',
  urlLock: 'none',
  ...patch,
})

test('reads stored ids and rejects anything else', () => {
  assert.equal(bookIdFromPath(`/book/${id}`), id)
  assert.equal(bookIdFromPath(`/book/${id}/`), id)
  assert.equal(bookIdFromPath(`/book/${id.toUpperCase()}`), id)
  assert.equal(bookIdFromPath(`/book/${local}`), local)
  assert.equal(bookIdFromPath('/'), null)
  assert.equal(bookIdFromPath('/books/' + id), null)
  assert.equal(bookIdFromPath('/book/'), null)
  assert.equal(bookIdFromPath('/book/..'), null)
  assert.equal(bookIdFromPath('/book/a%2F..%2Fsecret'), null)
  assert.equal(bookIdFromPath('/book/' + 'a'.repeat(81)), null)
  assert.equal(pathForBook(local), '/book/bk_abc123')
  assert.equal(pathForBook(id), `/book/${id}`)
})

test('opening pushes the book path; sample and same-path loads replace', () => {
  const open = base({ open: true, bookId: id })
  assert.deepEqual(navForTransition(base(), open, { pathname: '/shelf', search: '' }), {
    type: 'push',
    path: `/book/${id}`,
    state: { bookId: id, open: true },
  })
  assert.deepEqual(navForTransition(base(), open, { pathname: '/', search: '?sample=zh' }), {
    type: 'replace',
    path: `/book/${id}`,
    state: { bookId: id, open: true },
  })
  assert.deepEqual(navForTransition(base(), open, { pathname: `/book/${id}`, search: '' }), { type: 'none' })
  assert.deepEqual(navForTransition(open, open, { pathname: `/book/${id}`, search: '' }), { type: 'none' })
})

test('closing the cover keeps the book url; leaving the book pushes the shelf', () => {
  const open = base({ open: true, bookId: local })
  const closed = base({ open: false, bookId: local })
  assert.deepEqual(navForTransition(open, closed, { pathname: `/book/${local}`, search: '' }), { type: 'none' })
  const left = base({ open: false, bookId: null })
  assert.deepEqual(navForTransition(open, left, { pathname: `/book/${local}`, search: '' }), {
    type: 'push',
    path: '/shelf',
    state: { bookId: null, open: false },
  })
  assert.equal(navForTransition(open, left, { pathname: '/shelf', search: '' }).type, 'none')
  assert.equal(navForTransition(closed, left, { pathname: `/book/${local}`, search: '' }).type, 'push')
  assert.equal(navForTransition(open, base({ session: 'anon' }), { pathname: `/book/${id}`, search: '' }).type, 'none')
  assert.equal(navForTransition(open, base({ session: 'checking' }), { pathname: `/book/${id}`, search: '' }).type, 'none')
  assert.equal(navForTransition(open, base({ urlLock: 'hold' }), { pathname: `/book/${id}`, search: '' }).type, 'none')
  assert.equal(navForTransition(open, base({ urlLock: 'keep' }), { pathname: `/book/${id}`, search: '' }).type, 'none')
})

test('switching books pushes the new id', () => {
  const a = base({ open: true, bookId: id })
  const b = base({ open: true, bookId: local })
  const action = navForTransition(a, b, { pathname: `/book/${id}`, search: '' })
  assert.equal(action.type, 'push')
  if (action.type === 'push') assert.equal(action.path, `/book/${local}`)
})
