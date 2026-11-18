# Infinite Reader - web

An EPUB reader on an infinite wooden desk. The book is a physical object: it opens, its pages curl and flutter
as they turn, the left/right page blocks grow and shrink, and text stays selectable. Highlights and inline reading notes live in the book. Notes use a quote-block style directly below the selected line, and the following text reflows around them.

Vite + React + TypeScript + three.js. No server needed - EPUB parsing, pagination and storage (IndexedDB) all run in the browser.

## Run

```bash
cd web
npm install
npm run dev        # http://localhost:5173  (add ?sample to auto-open the bundled Alice in Wonderland)
npm run build      # type-check + production build
npm run lint
```

Drop any `.epub` onto the desk (or use the Library button) to read your own book. `public/samples/alice.epub` is a
Project Gutenberg public-domain copy used for development.

## Using it

| Do this | To |
| --- | --- |
| Search on the Shelf | filter the entire library by title and author; combine words, ignoring case and character width |
| Compact / Spacious | switch between a responsive compact grid and the larger list; the choice is remembered on this device |
| Show more books | reveal the next 60 matches; search includes books not yet displayed |
| Drag the desk | pan (with inertia) |
| Scroll wheel / trackpad two-finger vertical scroll | gentle zoom at the cursor: up enlarges, down reduces; Ctrl/⌘ is optional |
| Pinch, `+` / `-` | zoom; `0` frames the book; double-click a page to focus it |
| Click the cover, or the book button | open / close the book |
| Drag a page corner or fore-edge, click it, `←` `→` `Space` | turn pages (real-time cloth simulation; release speed decides whether it lands) |
| Hover a page's outer margin | the corner lifts, the cursor becomes a grab hand and an edge chevron shows the clickable zone (a one-time hint flutters the corner on first open) |
| Viewing-angle button in the dock | top-down / default / oblique presets or a slider; eased, and remembered in `localStorage` |
| Click a round 注 marker | read a linked book footnote in place; Escape, the close button or a click outside dismisses it; long notes scroll |
| Select text | selection popover: highlight/underline in 6 colours, inline note, **Ask AI**, copy |
| Click a marked passage | recolour, switch highlight/underline, add or edit its note, remove |
| Click an inline note | edit its text, text colour and tags; its palette is independent of the original passage's highlight/underline palette; Done or Ctrl/Cmd+Enter applies the new layout |
| Write a long note | continue across pages without changing original-text offsets or AI citation targets |

## Architecture

```
src/book/      epub.ts (zip + OPF/XHTML parser) -> layout.ts (typesetter: spreads, widows/orphans) -> pageRender.ts (page canvas, marks, ink)
src/engine/    three.js scene
  scene.ts       camera (tilted perspective), pan/zoom/inertia, gestures, render loop, DOM text-layer alignment (matrix3d homography)
  book.ts        cover hinge, spine, left/right stacks, flying leaves
  leafSim.ts     position-based-dynamics sheet (distance + bending + air drag) driving a turning leaf
  leafMesh.ts    Catmull-Rom upsampled deformable mesh, curvature attribute
  paperMaterial  two-sided paper shader: mirrored verso, show-through of the opposite page, back-lit translucency, fibres
  stack.ts       page-block thickness (continuous, follows how many leaves are turned) with striped fore-edges
  reflowTarget.ts preserves the source passage or note continuation when pagination changes
  desk.ts        procedural infinite wood (world-space grain, plank seams)
  textLayer.ts   transparent DOM words and inline-note edit targets -> selection, copy, accessibility
src/store/     zustand store (library, annotations, popovers, ask state)
src/ui/        React chrome: dock, popovers, note editor, drawers, ask panel, drop zone
src/storage/   StorageAdapter, IndexedDB + HTTP (Worker) implementations, runtime switch
src/api/       http.ts (cookie fetch + error envelope), auth.ts, ask.ts (SSE client + offline mock)
```

See [`API_CONTRACT.md`](./API_CONTRACT.md) for the backend contract the client assumes.

## Page-turn notes

Every turn (drag, click, arrow key) drives the same leaf model: a hinged sheet pinned at the spine and held at the middle of the
fore-edge (or at the corner when a drag starts there). The held row follows a single constant-curvature arc (`curlAngles` in
`leafSim.ts`, curl radius about 8 units on a 6.4 wide page): the lifted edge rises first, the sheet bows over the spine, and once
released the curvature reverses so the leaf unrolls spine-first onto the stack. Rows away from the hand trail by at most ~0.2 rad
with a smooth falloff, a speed-dependent flex term bends the sheet a little more when it is carried fast and rings once when it
stops, and the landing is damped harder over the last stretch with a small restitution on the stack. The hover/flutter peel
(`LeafMesh.write`) is the same kind of arc, so it reads as a lifted edge rather than a crumpled corner. Tunables: `CURL_LEAD`,
`CURL_UNROLL`, `ROW_LAG` in `leafSim.ts`; spring and flex constants in `BookModel.stepFlyers`.

## Backend

The app works fully offline (IndexedDB). When the Cloudflare Worker backend is reachable it asks you to sign in (email code or Google)
and then stores books, marks and inline notes in your account and answers *Ask AI* through `POST /api/ask`. Both live behind
`StorageAdapter` (`src/storage`) so nothing else in the app knows which one is active. Details: [`API_CONTRACT.md`](./API_CONTRACT.md),
backend reference: [`../worker/API.md`](../worker/API.md).

```bash
npm run dev                                   # /api is proxied to the deployed Worker (cookie session stays same-origin)
API_PROXY=http://localhost:8787 npm run dev   # ...or to a local `wrangler dev`
VITE_BACKEND=local npm run dev                # never talk to the backend (IndexedDB + mock AI)
```

Notes: the session cookie is `Secure`; Chrome accepts it on `http://localhost`, Safari does not (use Chrome or HTTPS there).
"Continue offline" on the sign-in card keeps working with local data; the account chip (top right) lets you sign in later or out.

## Typesetting notes

`src/book/layout.ts` paginates onto the true page content box (page minus margins). Text is tokenised per ideograph
(Latin words stay whole, long URLs/words are chopped so nothing can overflow), with CJK line-breaking rules (no closing
punctuation or dashes/ellipses at the start of a line, no opening brackets at the end), closing punctuation hanging into
the margin, 2em paragraph indents, inter-character justification that never stretches runs of Latin text, centred and
contained figures with captions kept together, and widow/orphan control. The serif stack falls back to Noto Serif SC /
Source Han Serif / Songti / SimSun. `?sample=zh` opens `public/samples/zh-sample.epub`
(regenerate with `python3 scripts/make-zh-sample.py`).

## Debug / test hooks

`window.__reader` exposes the scene. `__reader.advance(seconds)` steps the physics deterministically (pauses the loop;
set `__reader.paused = false` to resume) and `__reader.snap()` returns a PNG data URL of the canvas - handy for
screenshots on machines with software WebGL.

### Interaction regression scripts

`scripts/check-turn-grab.mjs` (peel handoff on grab/click/key turns; cover and page drags whose pointer-up never arrives) and
`scripts/fuzz-pointer-sequences.mjs` (seeded random pointer/key sequences with state invariants) drive the app in headless Chrome
against a local-mode dev server; see the headers for usage.

## Inline reading notes

Notes are separate pagination fragments (`Page.notes`), inserted after the visual line containing the end of the selected passage. Original chapter text and character offsets are unchanged. Short notes stay together where possible; long notes continue on following pages. A thin left rule, small label and inset text distinguish personal notes from the original book.

Edits are persisted while typing; pagination updates when editing finishes so the page does not jump during input. Existing note text, colours and tags load automatically in the new presentation. Legacy `x/y/rot` fields remain in storage for compatibility; there is no database migration. Removing a note retains its highlight and lets the source text flow back.

Run `node --test --test-concurrency=2 'src/**/*.test.ts'` for layout and navigation regressions. `scripts/check-inline-notes.mjs` exercises real selection, creation, editing, reload, long notes, typeface changes and deletion against a local-mode Vite server; see its header for browser setup.

## Footnote regression

With Vite running in local mode, run `PUPPETEER_CORE=<module path> node scripts/check-footnotes.mjs`. The fresh-profile browser test covers WeRead-style superscript links, EPUB semantic notes, cross-file targets outside the spine, missing/ordinary links, unchanged source offsets, keyboard dismissal and narrow screens. Set `EPUB_FILE` to additionally check a local EPUB without uploading it. Definitions already available through a popup no longer occupy chapter pages, while source text and offsets remain intact. Unlinked definitions, illustrated/table notes and definitions with reader notes remain visible; popup text is rendered as plain text.
