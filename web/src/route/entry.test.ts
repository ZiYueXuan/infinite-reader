import assert from 'node:assert/strict'
import test from 'node:test'
import { isLandingRoute } from './entry.ts'

test('public home accepts language and section links without loading the reader', () => {
  assert.equal(isLandingRoute('/', ''), true)
  assert.equal(isLandingRoute('/', '?lang=zh-CN'), true)
  assert.equal(isLandingRoute('/', '?utm_source=friend&lang=en'), true)
})
test('shelf, book deep links, legacy samples and sign-in errors retain the reader shell', () => {
  for (const [path, search] of [['/shelf', ''], ['/shelf', '?lang=en'], ['/book/bk_sample', ''], ['/', '?sample=zh'], ['/', '?sample='], ['/', '?auth_error=google_denied']]) {
    assert.equal(isLandingRoute(path, search), false, path + search)
  }
})
