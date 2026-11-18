import { slides } from './routes/slides';
import { handleSlidesMessage, type SlidesMessage } from './slides/jobs';
import { handleBookListMessage, type BookListMessage } from './booklist/jobs';
import { booklists } from './routes/booklists';
import { requestLocale, translate } from '../../shared/i18n';
import { meterAccountRequest } from './lib/costMeter';
import { readReplication } from './lib/readReplication';
import { costs } from './routes/costs';
import { Hono } from "hono";
import { type AppEnv, originCheck } from "./auth";
import { HttpError } from "./lib/util";
import { databaseUnavailable } from "./lib/databaseErrors";
import { PAGES } from "./pages";
import { indexQueueHandler, type IndexMessage } from "./pipeline";
import { ask } from "./routes/ask";
import { auth } from "./routes/auth";
import { books } from "./routes/books";
import { marks } from "./routes/marks";
import { mindmaps } from './routes/mindmaps';
import { atlas } from "./routes/atlas";
import { siteEntry } from './publicSite';

export { ReaderAgent } from "./agent/ReaderAgent";

export const app = new Hono<AppEnv>();

for (const path of ['/', '/index.html', '/shelf', '/shelf/', '/book/*']) {
  app.get(path, c => siteEntry(c.req.raw, c.env.ASSETS));
}
// Build artifacts are fetched internally through ASSETS, never canonical public URLs.
app.get('/_landing/*', c => c.text('Not found', 404, { 'x-robots-tag': 'noindex' }));

for (const path of Object.keys(PAGES).flatMap((p) => [p, `${p}/`])) {
  app.get(path, (c) =>
    c.html(PAGES[path.replace(/\/$/, "")]!(c.env, requestLocale(c.req.raw)), 200, {
      "cache-control": "private, no-store",
      "content-language": requestLocale(c.req.raw),
      "vary": "Cookie, Accept-Language",
      "set-cookie": `ir_locale=${requestLocale(c.req.raw)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    }),
  );
}

app.use("/api/*", originCheck);
app.use("/api/*", async (c, next) => {
  await next();
  if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
  c.res.headers.set("x-robots-tag", "noindex, nofollow");
  c.res.headers.set("x-content-type-options", "nosniff");
});

app.get("/api/health", (c) => c.json({ ok: true, name: c.env.APP_NAME, time: Date.now() }));
app.use("/api/*", readReplication);
app.use("/api/*", meterAccountRequest);
app.route("/api/costs", costs);
app.route("/api/auth", auth);
app.route("/api/books", books);
app.route("/api/books", booklists);
app.route("/api/books", marks);
app.route("/api/books", atlas);
app.route("/api/books", mindmaps);
app.route("/api/books", slides);
app.route("/api/ask", ask);

app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: translate("No such endpoint", requestLocale(c.req.raw)) } }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (err.status === 429 && typeof err.extra?.retryAfter === "number") headers["retry-after"] = String(err.extra.retryAfter);
    return c.json({ error: { code: err.code, message: translate(err.message, requestLocale(c.req.raw)), ...err.extra } }, err.status as 400, headers);
  }
  console.error(JSON.stringify({ message: "unhandled error", path: c.req.path, error: err instanceof Error ? err.stack : String(err) }));
  if (databaseUnavailable(err)) {
    return c.json({ error: { code: "database_unavailable", message: translate("Account storage is temporarily unavailable. Please try again shortly.", requestLocale(c.req.raw)) } }, 503, { "retry-after": "30", "cache-control": "no-store" });
  }
  return c.json({ error: { code: "internal_error", message: translate("Internal server error", requestLocale(c.req.raw)) } }, 500);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<IndexMessage | BookListMessage | SlidesMessage>, env: Env) {
    for (const message of batch.messages) {
      if (message.body.type === 'slides') {
        try { await handleSlidesMessage(env, message.body); message.ack(); }
        catch { message.retry({ delaySeconds: 30 }); }
      } else if (message.body.type === 'booklist') {
        try { await handleBookListMessage(env, message.body); message.ack(); }
        catch { message.retry({ delaySeconds: 30 }); }
      } else {
        // Keep book-list failures separate: they must never mark the original book as failed.
        await indexQueueHandler({ ...batch, messages: [message as Message<IndexMessage>] }, env);
      }
    }
  },
} satisfies ExportedHandler<Env, IndexMessage | BookListMessage | SlidesMessage>;
