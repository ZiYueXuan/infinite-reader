import { translate, type Locale } from '../../shared/i18n';
import { aboutZh, privacyZh } from './pages-zh';
import { termsBody } from './legal/terms-2026-10-29';
import { seoHead } from '../../shared/seo';

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(opts: { title: string; app: string; description: string; body: string; active: "about" | "privacy" | "terms"; locale: Locale }) {
  const t = (key: string) => translate(key, opts.locale);
  const local = (href: string) => `${href}?lang=${opts.locale}`;
  const link = (href: string, label: string, key: string) =>
    `<a href="${local(href)}"${opts.active === key ? ' aria-current="page"' : ""}>${t(label)}</a>`;
  return `<!doctype html>
<html lang="${opts.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead('/' + opts.active, opts.locale, `${t(opts.title)} · ${opts.app}`, opts.description)}
<meta name="color-scheme" content="light dark">
<style>
  :root { --bg:#faf8f4; --fg:#2a2623; --muted:#6f6760; --card:#ffffff; --line:#e7e1d8; --accent:#9a4f1d; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16130f; --fg:#ece6dd; --muted:#a39a8e; --card:#1e1a15; --line:#332d25; --accent:#e0985f; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.7 ui-serif, Georgia, "Iowan Old Style", "Songti SC", serif; }
  header, main, footer { max-width: 44rem; margin: 0 auto; padding: 0 1.25rem; }
  header { display:flex; align-items:center; justify-content:space-between; padding-top:1.75rem; padding-bottom:1rem; font-family: ui-sans-serif, system-ui, sans-serif; font-size:.95rem; }
  .brand { font-weight:700; letter-spacing:.01em; color:var(--fg); text-decoration:none; }
  nav { display:flex; gap:1.1rem; flex-wrap:wrap; } header { gap:1rem; flex-wrap:wrap; }
  nav a { color:var(--muted); text-decoration:none; }
  nav a[aria-current], nav a:hover { color:var(--accent); }
  main { padding-top:1.5rem; padding-bottom:3rem; }
  h1 { font-size:2.1rem; line-height:1.2; margin:.2rem 0 .4rem; }
  h2 { font-size:1.2rem; margin:2.2rem 0 .4rem; font-family: ui-sans-serif, system-ui, sans-serif; }
  p, li { margin:.5rem 0; }
  ul { padding-left:1.25rem; }
  .meta { color:var(--muted); font-family: ui-sans-serif, system-ui, sans-serif; font-size:.9rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:1rem 1.25rem; margin:1.25rem 0; }
  a { color:var(--accent); }
  .btn { display:inline-block; background:var(--accent); color:var(--bg); padding:.6rem 1.1rem; border-radius:999px; text-decoration:none; font-family: ui-sans-serif, system-ui, sans-serif; font-weight:600; }
  footer { padding-top:1.5rem; padding-bottom:2.5rem; border-top:1px solid var(--line); color:var(--muted); font-family: ui-sans-serif, system-ui, sans-serif; font-size:.9rem; display:flex; gap:1.1rem; flex-wrap:wrap; }
  footer a { color:var(--muted); }
</style>
</head>
<body>
<header>
  <a class="brand" href="${local("/about")}">${esc(opts.app)}</a>
  <nav>${link("/about", "About", "about")}${link("/privacy", "Privacy", "privacy")}${link("/terms", "Terms", "terms")}<a href="/${opts.active}?lang=${opts.locale === "en" ? "zh-CN" : "en"}" lang="${opts.locale === "en" ? "zh-CN" : "en"}" aria-label="${opts.locale === "en" ? "Switch to Chinese" : "切换到英文"}">${opts.locale === "en" ? "中文" : "English"}</a></nav>
</header>
<main>
${opts.body}
</main>
<footer><span>© ${new Date().getFullYear()} ${esc(opts.app)}</span><a href="${local("/privacy")}">${t("Privacy Policy")}</a><a href="${local("/terms")}">${t("Terms of Use")}</a><a href="/shelf">${t("Open the reader")}</a></footer>
</body>
</html>`;
}

export function aboutPage(env: Env, locale: Locale = "en"): string {
  const app = env.APP_NAME;
  return layout({
    app, locale,
    active: "about",
    title: "About",
    description: locale === "zh-CN" ? `${app}：无限画布上的网页 EPUB 阅读器，支持划线、便笺和 AI 阅读伙伴。` : `${app} is a web EPUB reader on an infinite canvas with highlights, sticky notes and an AI reading companion.`,
    body: locale === "zh-CN" ? aboutZh(app) : `
<h1>${esc(app)}</h1>
<p class="meta">A calmer way to read, annotate and think with your books.</p>
<p>${esc(app)} is a web EPUB reader built on an infinite canvas. Upload your own EPUB books, read them with page-turn animations, mark passages with highlights and underlines, pin sticky notes anywhere on the canvas, and ask an AI companion questions about a selected passage or the whole book, with answers that cite the parts of the book they come from.</p>
<div class="card">
  <strong>Signing in</strong>
  <p>You can sign in with a one-time code sent to your email address, or with your Google Account. We use your Google account only to learn your verified email address, name and profile picture so we can create and recognise your account. We never read your Gmail, Drive or any other Google data.</p>
</div>
<p><a class="btn" href="/shelf">Open the reader</a></p>
<p>Read how your data is handled in the <a href="/privacy">Privacy Policy</a> and the <a href="/terms">Terms of Use</a>.</p>`,
  });
}

export function privacyPage(env: Env, locale: Locale = "en"): string {
  const app = env.APP_NAME;
  const contact = env.CONTACT_EMAIL;
  return layout({
    app, locale,
    active: "privacy",
    title: "Privacy Policy",
    description: locale === "zh-CN" ? `${app} 如何收集、使用和保护你的数据。` : `How ${app} collects, uses and protects your data.`,
    body: locale === "zh-CN" ? privacyZh(app, contact) : `
<h1>Privacy Policy</h1>
<p class="meta">Last updated October 30, 2026</p>
<p>This policy explains what ${esc(app)} (“the service”, “we”) collects when you use it, why, and the choices you have. We keep it short because we collect little.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>Account information.</strong> Your email address and, if you sign in with Google, your name and profile picture as provided by Google. We do not receive your Google password and we request only the <code>openid</code>, <code>email</code> and <code>profile</code> scopes.</li>
  <li><strong>Your content.</strong> The ebooks and other supported files you upload, text extracted from them for search, and the highlights, underlines, sticky notes, reading progress, canvas layout and AI chat history you create.</li>
  <li><strong>Terms acceptance.</strong> Your account ID, the version of the Terms of Use you expressly accept, acceptance and recording timestamps, and sign-in method. We use these records to document the agreement, enforce account access and address disputes; they are kept with your account and removed on account deletion unless applicable law requires retention.</li>
  <li><strong>Usage diagnostics.</strong> AI token/compute usage, request and database/file-operation counts, timestamps, account/book identifiers and estimated costs help you inspect usage and help us operate the service. These diagnostic records do not store additional book passages or prompts.</li>
  <li><strong>Technical data.</strong> A session cookie that keeps you signed in, a hashed IP address and user-agent stored with the session for security, and standard request logs kept by our infrastructure provider for operations and abuse prevention.</li>
</ul>

<h2>How we use it</h2>
<ul>
  <li>To authenticate you and keep you signed in (one-time codes are stored only as salted hashes and expire after 10 minutes).</li>
  <li>To store and display your books and annotations, and to make your books searchable so the AI companion can find relevant passages.</li>
  <li>To answer your questions. When you ask the AI companion something, the question, the passage you selected, nearby text and the most relevant excerpts from that book are sent to our language-model provider to generate the answer.</li>
  <li>To recognize maps on request. When you choose map recognition, that illustration and the book title are sent to DeepSeek to identify the region and place names. If its result cannot be used reliably, the same illustration and title are sent to GLM-5.3 Flash hosted by Cloudflare Workers AI for one fallback attempt. Recognition results are cached privately for your book and removed when you delete it. Illustrations are not sent automatically when you open or turn pages.</li>
  <li>To protect the service from abuse (rate limiting) and to fix problems.</li>
</ul>
<p>We do not sell your data, show ads, or use your books or conversations to train models ourselves.</p>

<h2>Who processes your data</h2>
<ul>
  <li><strong>Cloudflare</strong> hosts the service and stores your data (Workers, D1, R2, Vectorize, Queues), sends sign-in emails, and processes embeddings and fallback map recognition through Workers AI.</li>
  <li><strong>Google</strong> authenticates you if you choose “Sign in with Google”.</li>
  <li><strong>DeepSeek</strong> receives the content described above when you use the AI companion or map recognition, and processes it under its own terms and privacy policy.</li>
</ul>
<p>Only upload books you have the right to use. Your books are private to your account and are not shared with other users.</p>

<h2>Cookies</h2>
<p>We use one essential, HttpOnly session cookie (and a short-lived cookie during Google sign-in). We also save your interface language preference to keep the language consistent between pages. We do not use advertising or analytics cookies.</p>

<h2>Retention and deletion</h2>
<p>Your data is kept while your account exists. Deleting a book in the app removes its file, extracted text, search index, annotations, notes and chat history. Sign-in sessions expire automatically. To delete your whole account and all associated data, email us at the address below and we will do it promptly.</p>

<h2>Your rights</h2>
<p>You can ask us to access, correct, export or delete your personal data at any time. If you are in the EEA, UK or a similar jurisdiction you may also have the right to object to or restrict processing and to complain to your data-protection authority.</p>

<h2>Children</h2>
<p>The service is not directed to children under 13 and we do not knowingly collect their data.</p>

<h2>Changes</h2>
<p>We may update this policy and will change the date above when we do. Material changes will be announced in the app.</p>

<h2>Contact</h2>
<p>Questions or requests: <a href="mailto:${esc(contact)}">${esc(contact)}</a>.</p>`,
  });
}

export function termsPage(env: Env, locale: Locale = "en"): string {
  const app = env.APP_NAME;
  const contact = env.CONTACT_EMAIL;
  return layout({
    app, locale,
    active: "terms",
    title: "Terms of Use (TOU)",
    description: locale === "zh-CN" ? `${app} 使用条款，包括电子书版权和上传责任。` : `Terms of Use for ${app}, including ebook copyright and upload responsibilities.`,
    body: localizedTerms(app, contact, locale),
  });
}

// Keep the published agreement immutable; display its existing language sections.
function localizedTerms(app: string, contact: string, locale: Locale) {
  const body = termsBody(app, contact);
  if (locale === 'en') return body.replace(/<section id="chinese"[\s\S]*?<\/section>/, '').replace(/<a href="#chinese">[\s\S]*?<\/a>/, '<a href="/terms?lang=zh-CN">中文</a>');
  return body.match(/<section id="chinese"[\s\S]*?<\/section>/)?.[0] ?? body;
}

export const PAGES: Record<string, (env: Env, locale?: Locale) => string> = {
  "/about": aboutPage,
  "/privacy": privacyPage,
  "/terms": termsPage,
};
