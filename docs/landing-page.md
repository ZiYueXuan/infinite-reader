# Public landing page

The public home is `/`; the reading library is `/shelf`. The app still accepts `/book/:id`, old `/?sample=...` links, and OAuth error URLs. Reader back navigation goes to `/shelf`. The landing page does not initialize account sessions, book storage, EPUB processing, or the interactive `ReaderScene`.

## Scroll-driven product story

`LandingExperience.tsx` replaces the screenshot preview with a native scrolling, sticky stage. `landingStory.ts` defines one shared ten-chapter timeline for copy, overlays, navigation and the reader’s actual `BookModel`, composed by `landingBookScene.ts`:

1. Opening the cover and turning a curved page.
2. Adjusting pitch while facing the book directly to reveal thickness and layered page edges. The book stays fixed; `readerCamera.ts` supplies the exact perspective camera orbit used by `ReaderScene`. Angle readout and slider share its pitch value and limits. A lens shift positions the showcase to the right without turning the camera sideways.
3. Reading fonts and desk themes.
4. Passage highlights and underlining. The book highlight follows the first body sentence using its actual painted baseline and measured text width, the reader’s shared `markBand` height rule, and the real curved page surface; it is not positioned independently in blank page space.
5. Inline Markdown: a literal minus, lists, emphasis and a blockquote appear progressively.
6. Automatic note saving, distinguishing signed-in sync from local guest storage.
7. The Infinite Agent reading companion: checking contents, finding and reading relevant passages, responding with illustrated source references, and continuing the conversation. This sequence uses sample text and does not call the live Agent.
8. Unfolding a mind map.
9. Exploring supported book maps on a rotating globe.
10. Fullscreen and fitting the book to the screen.

Previous/next buttons and a compact native chapter selector jump to the appropriate scroll positions; a skip link leaves the sequence. Scrolling upward reverses the model. The content is an illustrative feature demonstration, not live user notes, cloud saves or generated AI output. `LandingMarkdownDemo.tsx` lazily loads the existing `react-markdown` and `remark-gfm` renderer, rather than simulating formatting with custom Markdown parsing. The actual reader's Milkdown editor is unchanged.

The model is loaded near the viewport. Covers, case binding, paper stacks, gutter shape, resting leaves, and page-turn simulation come directly from `engine/book.ts` and its existing dependencies. The showcase seeks the real cover hinge and advances the real quick-turn simulation at fixed time steps, restarting that simulation on reverse scroll. It has no separate page-surface or page-turn formulas. Page textures are generated once at 1024 × 1536 after fonts load. The loading poster, static fallback and 3D cover all use the same locally bundled `landing-book-cover.webp`, with baked-in typography so font loading and locale changes cannot substitute a different cover. The scene waits for that image to decode and renders the current scroll position before replacing the poster; the canvas adapts to the viewport with a device pixel ratio capped at 2. A lightweight, local Natural Earth texture is loaded only near the map chapter (provenance in `web/public/landing/earth-source.md`). The globe has geographic graticules and markers for London, Paris and Rome. Rendering occurs on scroll/resize and while settling, and stops off screen or in a hidden tab. Geometry, materials, textures, observers, listeners and WebGL context are disposed on unmount or language changes. No external models, new dependencies, API requests or paid model calls are needed.

Reduced-motion preferences, short viewports (including phones up to 700px tall), unavailable WebGL, and context loss use the same cover artwork in a lightweight static book illustration and all ten readable feature descriptions without the long sticky scroll. Chinese and English layouts include mobile support. Original reader screenshots remain in `web/public/landing/` as unused historical assets.

Validation: `web/scripts/check-landing.mjs` covers the story, languages, mobile, reduced motion / WebGL fallback, and navigation between landing, shelf, and actual sample reading. Set `LANDING_URL` and `PUPPETEER_CORE` to run against a local server with Chromium. Entry routing is also covered by `web/src/route/entry.test.ts` and `bookPath.test.ts`.

`node --experimental-strip-types --test web/src/ui/landingStory.test.ts` checks every chapter stop, reversible overlay visibility, and the shared perspective camera’s front-facing projection. Binding/gutter geometry remains covered by the engine tests. `web/scripts/check-showcase-reader-model.mjs` compares the scroll-seek endpoints against normal reader-model construction and checks actual reader camera angles in-browser (requires a Vite server).

The shared cover asset can be regenerated with `web/scripts/generate-landing-cover.mjs` (same Chromium / `PUPPETEER_CORE` setup as the browser checks). It uses the bundled OFL EB Garamond and Inter fonts; it needs no image service or network access.

`web/scripts/check-landing-cover.mjs` delays the 3D chunk to check the loading poster, verifies WebGL uploads that exact image, and checks context-loss and reduced-motion fallbacks in Chinese desktop and English mobile layouts.

`web/scripts/check-landing-highlight.mjs` checks rendered highlight pixels against the unmarked page’s ink in Chinese/English desktop/mobile layouts, including partial growth and reverse scrolling.
