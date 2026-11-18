# Public-site SEO

The web build renders the real landing React component into English and Simplified Chinese HTML. Workers select the appropriate static HTML using the existing language preference rules. This adds no request-time React rendering, database queries, or AI calls. The client leaves the prerender visible until its interactive landing module is ready.

`shared/seo.ts` owns public titles/descriptions, canonical URLs, reciprocal hreflang links, Open Graph/Twitter tags and WebSite/WebApplication structured data. Explicit `?lang=en` and `?lang=zh-CN` URLs are canonical; the language-negotiated URL is x-default. Public information pages use the same metadata helpers. Switching language on the landing updates its metadata as well as its visible content.

The build generates `/sitemap.xml` with the two language versions of the homepage, about, privacy and terms pages, and `/robots.txt` advertising that sitemap. Private reader shells (`/shelf`, `/book/*`, legacy sample/OAuth entry URLs and `/index.html`) have noindex metadata and response headers. They remain crawlable so engines can see noindex; authentication still protects the underlying user data. API crawling is disallowed and API responses carry noindex. Internal prerender URLs return 404 publicly. Unknown routes now return a genuine static 404 rather than a successful copy of the application shell.

Validation:

- `npm --prefix web run build` also regenerates landing HTML, robots.txt and sitemap.xml.
- `npm --prefix worker test -- test/seo.test.ts test/i18n.test.ts` checks localization, canonical URLs and indexing boundaries.
- Run local Wrangler on port 8788, then `node web/scripts/check-seo.mjs` to verify the built routes, initial HTML, stylesheet/share image URLs, sitemap URLs and 404s. Set `SEO_ORIGIN=https://ereader.space` for post-deployment checks (use Node's `--use-env-proxy` where required).

Search-engine account verification and submission are external steps, not performed by deployment. Submit `https://ereader.space/sitemap.xml` in a verified Google Search Console/Bing Webmaster Tools property when those accounts are available. Do not add fabricated ratings, prices or search actions to structured data.
