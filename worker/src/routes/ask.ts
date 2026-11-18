import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireAuth } from "../auth";
import { HttpError, enforceRateLimit, parseBody } from "../lib/util";
import { ownedBook } from "./books";
import { askSchema } from "../agent/protocol";
import { agentRequest } from "../agent/client";

export const ask = new Hono<AppEnv>();
ask.use("*", requireAuth);

ask.post("/", async c => {
  const body = await parseBody(c, askSchema);
  const book = await ownedBook(c, body.bookId);
  c.set("costBookId", book.id);
  if (!c.env.DEEPSEEK_API_KEY) throw new HttpError(503, "llm_not_configured", "DEEPSEEK_API_KEY is not set");
  await enforceRateLimit(c.env.DB, `ask:${c.get("user").id}`, 30, 60);
  const scope = { userId: c.get("user").id, bookId: book.id, threadId: body.threadId };
  return agentRequest(c.env, scope, "/start", { scope, input: body });
});

const operationSchema = z.object({
  bookId: z.string().min(1).max(100), threadId: z.string().min(1).max(100).default("default"),
  operationId: z.string().regex(/^[\w-]{1,100}$/),
});

ask.get("/stream", async c => {
  const parsed = operationSchema.safeParse(c.req.query());
  if (!parsed.success) throw new HttpError(400, "invalid_request", "Invalid conversation request");
  const body = parsed.data;
  await ownedBook(c, body.bookId);
  c.set("costBookId", body.bookId);
  return agentRequest(c.env, { userId: c.get("user").id, bookId: body.bookId, threadId: body.threadId }, `/stream?operationId=${encodeURIComponent(body.operationId)}`);
});

ask.post("/cancel", async c => {
  const body = await parseBody(c, operationSchema);
  await ownedBook(c, body.bookId);
  c.set("costBookId", body.bookId);
  return agentRequest(c.env, { userId: c.get("user").id, bookId: body.bookId, threadId: body.threadId }, "/cancel", { operationId: body.operationId });
});
