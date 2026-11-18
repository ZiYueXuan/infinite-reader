# Chapter HTML slides

The table of contents offers a presentation icon next to the mind-map icon for chapters. Prologues (including `序章`, `序 章`, `序　章` and `Prologue`) are chapter-level entries and receive the same icon. Sections, parts, and other front/back matter do not receive the icon. The server independently checks eligibility against the owned EPUB. Numbered Chinese and English chapters take precedence; unnumbered navigation uses the first content level, including chapters nested under named parts. Ambiguous or incorrectly labelled EPUB navigation can still require publisher metadata fixes.

The first click starts a background job. A successful chapter deck is immutable and reused on every subsequent open. The viewer renders structured content as HTML using overview, points, timeline and comparison layouts; it never executes generated HTML, JavaScript, or CSS. The model chooses **1–10 total slides** based on chapter complexity, with no mandatory cover or closing page. Desktop includes an outline and 16:9 pages; narrow screens use a readable single-column layout. Previous/next buttons, arrow/PageUp/PageDown/Home/End keys, native fullscreen and Escape close are supported. Viewer shortcuts do not manipulate the underlying book.

## Source and generation

- Extract the complete chapter range, including sections and multiple spine files, up to the next chapter/part/back matter in source order.
- A unique exact numbered heading in body prose can repair a broken NCX pointer. Linked table-of-contents labels do not qualify as repairs. This handles the uploaded *抗日战争* NCX mistake where 第四十章 points at a copyright page (the book itself has three volumes).
- Omit standalone backlink endnote documents and repeated navigation pages, which some Calibre EPUBs append after a volume's last chapter.
- Split at paragraph boundaries into <=24,000-character parts. A short chapter needs one inference. Long chapters get one bounded summary per part, then one synthesis over **all** summaries. No silent beginning-only truncation; reject chapters over 1.2 million characters before inference.
- Summaries target 1,200–1,800 characters with a requested maximum of 2,400. Validation allows up to 3,200 characters to tolerate modest model overruns without dropping content. Larger or malformed summaries still fail validation. Previously rejected checkpoints that now meet this bound are reused on explicit retry without another summary call.
- This fixed pipeline uses the existing Cloudflare Queue and DeepSeek Flash, separately from the conversational Pi Agent's per-turn budget. No PPTX is created.

## Persistence and duplicate prevention

Migration `0008_chapter_slides.sql` adds a unique `(book_id, user_id, target)` job. Private R2 objects live under `users/{user}/books/{book}/slides/{operation}/`. Preparation, summaries and synthesis are separate queue steps. D1 compare-and-set claims each paid step; duplicate queue deliveries or clicks cannot launch a second call. Completed raw responses are checkpointed before parsing/advancing, and the final R2 result is readable even if the last D1 update failed. Model usage is metered under `chapter_slides`.

A known failed step can be explicitly retried; completed valid responses are reused. Invalid output is replaced only on explicit retry. An uncertain lost Worker keeps its lock and appears interrupted after ten minutes, requiring status rechecks instead of automatically billing again. Deleting a book removes the job via a foreign-key cascade and deletes private slide objects, including objects racing a provider completion.

## API

- `GET /api/books/:id/slides-index`: lightweight `readyTargets` for the owned book.
- `GET /api/books/:id/slides?target=<EPUB href>`: status/progress and saved deck; never inference.
- `POST /api/books/:id/slides` with `{target, retry?: boolean}`: enqueue once, return promptly. Defaults to reading an existing ready/running/failed state. Only explicit retry restarts a known failed step.

All routes require ownership, return private no-store responses, and accept no client-supplied source text. Admissions are limited to 3/minute and 20/day/user. The existing queue binding must be configured; original EPUB size is limited to 50 MiB.

## Verification

`npm --prefix worker test -- test/slides.test.ts test/mindmaps.test.ts`

`PUPPETEER_CORE=/path/to/puppeteer-core.js node web/scripts/check-chapter-slides.mjs`

The browser script uses a synthetic EPUB and intercepts every API request: chapter-only buttons, background completion, ready reuse, keyboard isolation, fullscreen event wiring (mocked API because headless Chromium does not complete native fullscreen requests), mobile layout and generated-text escaping. It creates no real user or paid inference.
