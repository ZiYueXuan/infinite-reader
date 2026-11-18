import { z } from 'zod';
import { webSourceUrl, type WebCitation } from '../../../shared/citations';
import { startAiCall } from '../lib/aiUsage';
import type { Operation } from './protocol';

export type WebSource = Omit<WebCitation, 'n'>;
/** DeepSeek accepts up to 128 Unicode characters, including Chinese and search operators. */
export function supportedSearchQuery(query: string) {
  const value = query.trim();
  return value.length > 0 && [...value].length <= 128 && !/\p{Cc}/u.test(value);
}
const responseSchema = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string(), summary: z.string().nullish(), snippet: z.string().nullish() })),
});

/** One paid attempt, no provider fallback or automatic retry. Book/context text is never attached. */
export async function searchWeb(env: Env, op: Operation, query: string, signal?: AbortSignal): Promise<WebSource[]> {
  if (!supportedSearchQuery(query)) throw new Error('web_search_unsupported_query');
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.max(1, Math.min(15_000, op.deadline - Date.now())))]);
  deadline.throwIfAborted();
  const call = await startAiCall(env, { operationId: op.id, userId: op.userId, bookId: op.bookId, feature: 'web_search', provider: 'deepseek', model: 'deepseek-search', inputCharacters: [...query.trim()].length });
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(deadline.reason);
      deadline.addEventListener('abort', onAbort, { once: true });
      if (deadline.aborted) onAbort();
    });
    const work = async () => {
      deadline.throwIfAborted();
      call.observe({ usage: { search_attempts: 1 } });
      const response = await fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/+$/, '')}/v1/tools/search`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), count: 5, need_content: false }), signal: deadline, redirect: 'manual',
      });
      deadline.throwIfAborted();
      call.http(response.status);
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
      if (requestId) call.observe({ id: requestId });
      if (!response.ok) {
        // A received provider failure is unbilled. A local timeout/cancellation is unknown.
        call.observe({ usage: { search_requests: 0, search_billable_requests: 0 } });
        throw new Error('web_search_unavailable');
      }
      if (response.status !== 200) throw new Error('web_search_unavailable');
      const body = responseSchema.parse(await response.json());
      deadline.throwIfAborted();
      // Count before URL filtering: a nonempty upstream result is billed even if all links are rejected.
      call.observe({ usage: { search_requests: 1, search_billable_requests: body.results.length ? 1 : 0 } });
      const seen = new Set<string>();
      return body.results.slice(0, 10).flatMap(item => {
        const url = webSourceUrl(item.url);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [{ kind: 'web' as const, url, title: item.title.slice(0, 240), snippet: (item.summary?.trim() || item.snippet || '').slice(0, 1200), retrievedAt: Date.now() }];
      }).slice(0, 5);
    };
    // Also bound providers that ignore AbortSignal; never accept a late response after cancellation.
    const sources = await Promise.race([work(), aborted]);
    await call.finish({ status: 'succeeded' });
    return sources;
  } catch {
    const code = signal?.aborted ? 'agent_cancelled' : deadline.aborted ? 'web_search_timeout' : 'web_search_unavailable';
    await call.finish({ status: signal?.aborted ? 'aborted' : 'failed', errorCode: code });
    throw new Error(code);
  } finally {
    if (onAbort) deadline.removeEventListener('abort', onAbort);
  }
}
