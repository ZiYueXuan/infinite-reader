/** Shared queue/cache for font subsets. Failed or timed-out subsets must be retryable. */
export function createFontDownloadCache<T>(load: (key: string, value: T) => Promise<void>, concurrency = 8) {
  const cached = new Map<string, Promise<void>>()
  const waiting: (() => void)[] = []
  let active = 0
  const run = () => {
    while (active < concurrency && waiting.length) waiting.shift()!()
  }
  return (key: string, value: T) => {
    const existing = cached.get(key)
    if (existing) return existing
    const pending = new Promise<void>((resolve, reject) => {
      waiting.push(() => {
        active++
        void Promise.resolve().then(() => load(key, value)).then(resolve, reject).finally(() => { active--; run() })
      })
    })
    cached.set(key, pending)
    void pending.catch(() => { if (cached.get(key) === pending) cached.delete(key) })
    run()
    return pending
  }
}

/** Per-subset deadlines, including the response body, instead of timing out a whole CJK font. */
export async function fetchFontBytes(url: string, timeoutMs = 30_000): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        // Missing/deleted assets will not be repaired by immediately repeating the request.
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          throw new FontHttpError(response.status)
        }
        throw new Error(`Font request failed (${response.status})`)
      }
      return await response.arrayBuffer()
    } catch (error) {
      if (attempt >= 1 || error instanceof FontHttpError) throw error
      // One fresh request for a transient network failure or stalled transfer.
    } finally { clearTimeout(timer) }
  }
}

class FontHttpError extends Error {
  constructor(status: number) { super(`Font request failed (${status})`) }
}
