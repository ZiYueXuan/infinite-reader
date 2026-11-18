import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpAskClient, parseSse, type AskEvent } from './ask.ts'

const encode = (event: string, data: unknown) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`
const response = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } })
async function collect(events: AsyncGenerator<AskEvent>) {
  const result: AskEvent[] = []
  for await (const event of events) result.push(event)
  return result
}

test('SSE preserves Chinese across byte boundaries and accepts replacement answers and empty citations', async () => {
  const bytes = new TextEncoder().encode(encode('answer', { text: '书中内容' }) + encode('meta', { citations: [] }) + encode('done', {}))
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } })
  assert.deepEqual(await collect(parseSse(body)), [
    { type: 'answer', text: '书中内容' }, { type: 'meta', citations: [] }, { type: 'done' },
  ])
})

test('EOF before a terminal event is a disconnection', async () => {
  await assert.rejects(collect(parseSse(response(encode('answer', { text: 'partial' })).body!)), /Connection interrupted/)
})

test('reconnect watches the same operation and replaces the partial answer', async t => {
  const calls: { url: string; init?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return response(encode('answer', { text: calls.length === 1 ? '书中' : '书中内容 [1]' }) + (calls.length === 1 ? '' : encode('done', {})))
  })
  let visible = ''
  for await (const event of new HttpAskClient().ask({ bookId: 'book', question: 'What happened?', operationId: 'stable-request' })) {
    if (event.type === 'answer') visible = event.text
  }
  assert.equal(visible, '书中内容 [1]')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].init?.method, 'POST')
  assert.equal(calls[1].init?.method, 'GET')
  assert.equal(new URL(calls[1].url, 'https://reader.test').searchParams.get('operationId'), 'stable-request')
  assert.equal(calls[1].init?.body, undefined)
})

test('uncertain admission retries with the same idempotency key', async t => {
  const inputs: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    inputs.push(init?.body as string)
    if (inputs.length === 1) throw new TypeError('Connection lost after admission')
    return response(encode('answer', { text: 'one answer' }) + encode('done', {}))
  })
  const events = await collect(new HttpAskClient().ask({ bookId: 'book', question: 'Hello' }))
  assert.equal(inputs.length, 2)
  assert.equal(inputs[0], inputs[1])
  assert.ok(JSON.parse(inputs[0]).operationId)
  assert.equal(events.at(-1)?.type, 'done')
})

test('provider failure is terminal and does not start an automatic new inference', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => response(encode('error', { code: 'agent_failed', message: 'Try again' })))
  assert.deepEqual(await collect(new HttpAskClient().ask({ bookId: 'book', question: 'Hello' })), [{ type: 'error', code: 'agent_failed', message: 'Try again' }])
  assert.equal(fetch.mock.callCount(), 1)
})

test('restored history resumes over GET and Stop uses the explicit cancel endpoint', async t => {
  const calls: { url: string; init?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return response(encode('done', {}))
  })
  const client = new HttpAskClient()
  const op = { bookId: 'book', operationId: 'pending', threadId: 'default' }
  await collect(client.resume(op))
  await client.cancel(op)
  assert.equal(calls[0].init?.method, 'GET')
  assert.equal(calls[1].url, '/api/ask/cancel')
  assert.equal(calls[1].init?.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].init?.body as string), op)
})
