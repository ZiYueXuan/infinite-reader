import { t, errorText } from '../i18n/runtime.ts'
import { api, toApiError, ApiError } from './http.ts'
import { getStorageMode } from '../storage/mode.ts'
import type { Citation } from '../../../shared/citations'
export type { Citation, BookCitation, WebCitation } from '../../../shared/citations'

export interface AskOperation { bookId: string; threadId?: string; operationId: string }
export interface AskRequest {
  bookId: string
  question: string
  operationId?: string
  selection?: { text: string; chapterTitle?: string; anchor?: Record<string, unknown> }
  context?: { before?: string; after?: string; chapterTitle?: string }
  readingPosition?: { chapter: number; start: number; chapterHref?: string; chapterTitle?: string }
  threadId?: string
}
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  interrupted?: boolean
  selection: { text?: string } | null
  citations: Citation[]
}
export interface ChatHistory {
  messages: ChatMessage[]
  pending: { operationId: string; messageId: string; userMessageId: string } | null
}
export function getAskHistory(bookId: string, signal: AbortSignal): Promise<ChatHistory> {
  return api('/books/' + encodeURIComponent(bookId) + '/chat?threadId=default', { signal })
}
export type AskEvent =
  | { type: 'meta'; messageId?: string; model?: string; retrieval?: 'ok' | 'skipped' | 'failed'; citations: Citation[] }
  | { type: 'answer' | 'delta' | 'reasoning'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'done' }
  | { type: 'error'; code?: string; message: string }

export interface AskClient {
  ask(req: AskRequest, signal?: AbortSignal): AsyncGenerator<AskEvent>
}

/** An EOF without a terminal event is a disconnection, not a successful answer. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const parse = (block: string): AskEvent | null => {
    let name = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) return null
    const raw = data.join('\n')
    if (raw === '[DONE]') return { type: 'done' }
    const payload = JSON.parse(raw) as Record<string, unknown>
    const type = (name === 'message' ? payload.type : name) as string
    if (type === 'delta' || type === 'reasoning' || type === 'answer') return { type, text: String(payload.text ?? '') }
    if (type === 'meta') return { type, citations: [], ...payload } as AskEvent
    if (type === 'tool') return { type, name: String(payload.name ?? '') }
    if (type === 'done') return { type }
    if (type === 'error') return { type, code: payload.code as string | undefined, message: errorText(String(payload.message ?? 'Stream interrupted'), 'Stream interrupted') }
    return null
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buf += done ? dec.decode() : dec.decode(value, { stream: true })
      if (done && buf.trim()) buf += '\n\n'
      let m: RegExpExecArray | null
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index)
        buf = buf.slice(m.index + m[0].length)
        const ev = parse(block)
        if (!ev) continue
        yield ev
        if (ev.type === 'done' || ev.type === 'error') return
      }
      if (done) throw new Error(t("Connection interrupted. Reopen this book to reconnect to the response."))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class HttpAskClient implements AskClient {
  private url: string
  constructor(url = '/api/ask') { this.url = url }
  ask(req: AskRequest, signal?: AbortSignal) {
    const input = { ...req, operationId: req.operationId ?? crypto.randomUUID() }
    return this.stream(input, signal, input)
  }
  resume(op: AskOperation, signal?: AbortSignal) { return this.stream(op, signal) }
  async cancel(op: AskOperation) {
    const response = await fetch(this.url + '/cancel', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op),
    })
    if (!response.ok) throw await toApiError(response)
  }
  private async *stream(op: AskOperation, signal?: AbortSignal, input?: AskRequest): AsyncGenerator<AskEvent> {
    let admitted = !input
    for (let attempt = 0; attempt < 3 && !signal?.aborted; attempt++) {
      try {
        const query = new URLSearchParams({ bookId: op.bookId, threadId: op.threadId ?? 'default', operationId: op.operationId })
        const response = await fetch(admitted ? this.url + '/stream?' + query : this.url, {
          method: admitted ? 'GET' : 'POST', credentials: 'include', signal,
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: admitted ? undefined : JSON.stringify(input),
        })
        if (!response.ok || !response.body) throw await toApiError(response)
        admitted = true
        yield* parseSse(response.body)
        return
      } catch (error) {
        if (signal?.aborted) return
        if (attempt < 2 && (!(error instanceof ApiError) || error.status >= 500)) {
          await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
          continue
        }
        const wait = error instanceof ApiError && error.retryAfter ? ' ' + t('Try again in {0}s.', error.retryAfter) : ''
        yield { type: 'error', code: error instanceof ApiError ? error.code : 'network', message: (error instanceof Error ? error.message : t("Connection failed")) + wait }
        return
      }
    }
  }
}

/** Offline stand-in used when signed out / no backend, so the Ask UI still works. */
export class MockAskClient implements AskClient {
  async *ask(req: AskRequest, signal?: AbortSignal): AsyncGenerator<AskEvent> {
    const q = req.question.trim() || t("Explain this passage.")
    const sel = req.selection?.text ?? ''
    const quote = sel.length > 120 ? sel.slice(0, 117) + '…' : sel
    const ctx = (req.context?.before?.length ?? 0) + (req.context?.after?.length ?? 0)
    const text =
      t("Here is a reading of the passage “{0}”.", quote) + '\n\n' +
      t("**In context.** The sentence sits inside a larger scene, and the surrounding text ({0} characters of context were provided) suggests the author is using it to set tone rather than advance the plot.", ctx) + '\n\n' +
      t("**On your question** — “{0}” — the key idea is how the wording signals the narrator's attitude: note the rhythm, the word choice, and what is left unsaid.", q) + '\n\n' +
      t("_This is a mock answer (offline mode). Sign in to get real, retrieval-grounded replies from the backend._")
    yield { type: 'meta', citations: [], retrieval: 'skipped' }
    for (const p of text.match(/\S+\s*/g) || [text]) {
      if (signal?.aborted) return
      await new Promise((r) => setTimeout(r, 22 + Math.random() * 40))
      yield { type: 'delta', text: p }
    }
    yield { type: 'done' }
  }
}

const http = new HttpAskClient()
const mock = new MockAskClient()
export const askClient = {
  ask: (req: AskRequest, signal?: AbortSignal) => (getStorageMode() === 'api' ? http : mock).ask(req, signal),
  resume: (op: AskOperation, signal?: AbortSignal) => http.resume(op, signal),
  cancel: (op: AskOperation) => http.cancel(op),
}
