import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFontDownloadCache, fetchFontBytes } from './fontDownloads.ts'

test('subsets share in-flight/completed downloads and respect the concurrency limit', async () => {
  const releases: (() => void)[] = []
  const started: string[] = []
  const load = createFontDownloadCache(async (key: string) => {
    started.push(key)
    await new Promise<void>(resolve => releases.push(resolve))
  }, 2)
  const a = load('a', null), duplicate = load('a', null), b = load('b', null), c = load('c', null)
  assert.equal(a, duplicate)
  await Promise.resolve()
  assert.deepEqual(started, ['a', 'b'])
  releases.shift()!()
  await a
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, ['a', 'b', 'c'])
  releases.splice(0).forEach(release => release())
  await Promise.all([a, b, c])
  await load('a', null)
  assert.equal(started.length, 3)
})

test('failed subsets are evicted without redownloading successful subsets', async () => {
  const attempts = new Map<string, number>()
  const load = createFontDownloadCache(async (key: string) => {
    const n = (attempts.get(key) ?? 0) + 1
    attempts.set(key, n)
    if (key === 'bad' && n === 1) throw new Error('timeout')
  })
  await load('good', null)
  await assert.rejects(load('bad', null), /timeout/)
  await Promise.all([load('good', null), load('bad', null)])
  assert.deepEqual([...attempts], [['good', 1], ['bad', 2]])
})

test('a stalled response body is aborted and retried once', async (t) => {
  let calls = 0
  let aborted = false
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls++
    if (calls === 2) return new Response(new Uint8Array([1, 2, 3]))
    return { ok: true, arrayBuffer: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }) } as Response
  })
  assert.equal((await fetchFontBytes('/font.woff2', 10)).byteLength, 3)
  assert.equal(calls, 2)
  assert.equal(aborted, true)
})

test('transient failures retry once; missing fonts fail without a retry loop', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 503 }) })
  await assert.rejects(fetchFontBytes('/font.woff2'), /503/)
  assert.equal(calls, 2)
  t.mock.restoreAll()
  calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 404 }) })
  await assert.rejects(fetchFontBytes('/missing.woff2'), /404/)
  assert.equal(calls, 1)
})
