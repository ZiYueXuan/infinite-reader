import assert from 'node:assert/strict'
import test from 'node:test'
import { phoneCurl, curlPoint, phoneTurnCommits, PHONE_CURL_TRAVEL } from './phoneCurl.ts'

test('resting and completed folds have no exposed curl or layout shift', () => {
  for (const v of [.05, .5, .95]) for (const x of [0, 2, 6.4]) for (const y of [-7, 0, 7]) {
    const flat = curlPoint(x, y, phoneCurl(6.4, 14, 0, v))
    assert.equal(flat.x, x); assert.equal(flat.y, y); assert.equal(flat.z, 0)
    const done = curlPoint(x, y, phoneCurl(6.4, 14, 1, v))
    assert.ok(done.x <= 1e-9); assert.equal(done.z, 0)
  }
})
test('dragged edge tracks travel while the uncurled text stays flat', () => {
  for (const progress of [.01, .04, .15, .3]) for (const grabV of [.1, .5, .9]) {
    const fold = phoneCurl(6.4, 14, progress, grabV)
    const edge = curlPoint(6.4, (grabV - .5) * 14, fold)
    assert.ok(Math.abs(edge.x - (6.4 - progress * PHONE_CURL_TRAVEL * 6.4)) < 1e-6)
    const flat = curlPoint(0, 0, fold)
    assert.equal(flat.x, 0); assert.equal(flat.z, 0)
    assert.ok(edge.z <= 6.4 * .13)
  }
})
test('diagonal folds remain finite with unit normals across tall and wide screens', () => {
  for (const h of [3, 14, 30]) for (const p of [0, .001, .1, .5, .999, 1]) for (const v of [0, 1]) {
    const fold = phoneCurl(6.4, h, p, v, 1 - v)
    for (let x = 0; x <= 6.4; x += .16) for (let y = -h / 2; y <= h / 2; y += h / 20) {
      const q = curlPoint(x, y, fold)
      assert.ok(Object.values(q).every(Number.isFinite))
      assert.ok(Math.abs(Math.hypot(q.nx, q.ny, q.nz) - 1) < 1e-9)
    }
  }
})
test('release distinguishes deliberate drag, flick, hesitation and pullback', () => {
  assert.equal(phoneTurnCommits(.1, 0), false)
  assert.equal(phoneTurnCommits(.3, 0), true)
  assert.equal(phoneTurnCommits(.05, .8), true)
  assert.equal(phoneTurnCommits(.01, 2), false)
  assert.equal(phoneTurnCommits(.7, -.6), false)
})
