import { readerAgent, type Scope } from "./protocol";

/** Internal binding only. Public routes must verify ownership before addressing a conversation. */
export async function agentRequest(env: Env, scope: Scope, path: string, body?: unknown): Promise<Response> {
  const init = body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await readerAgent(env, scope).fetch(`https://reader.internal${path}`, init);
  // Binding responses have immutable headers; the public API adds security headers.
  return new Response(response.body, response);
}

export async function clearBookAgents(env: Env, userId: string, bookId: string, threadId?: string) {
  const rows = threadId ? [threadId] : ["default", ...(await env.DB.prepare(
    "SELECT DISTINCT thread_id FROM chat_messages WHERE user_id = ? AND book_id = ?",
  ).bind(userId, bookId).all<{ thread_id: string }>()).results.map(r => r.thread_id)];
  for (const thread of new Set(rows)) {
    const response = await agentRequest(env, { userId, bookId, threadId: thread }, "/clear", {});
    if (!response.ok) throw new Error("Could not clear conversation");
  }
}
