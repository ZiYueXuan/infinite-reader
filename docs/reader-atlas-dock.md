# Saved maps beside the reader

The bottom-left two-button capsule appears once the current book has a successfully recognized image map with an EPUB anchor, or a grounded text place. Image maps retain separate entries; all successful text results from this book share one “Places from this book” entry, deduplicated by geographic source ID. The left folded-map icon lists only image maps in book order with chapter and current printed page labels. The right text-and-pin icon opens the book-wide text miniature directly, without a list step. Each half has its own label, tooltip, expanded state and disabled state when its category has no results. Clicking the active half closes its panel; switching categories resets to the compact view. The location link returns to the image; the map title opens a non-modal miniature Atlas, approximately one sixth of the desktop viewport (one third width, one half height). Narrow screens use a wider, shorter panel above the reading controls.

The miniature supports the existing globe/region/terrain controls, city selection, expand/shrink in place above the same bottom-left globe, return to the image list for image maps, and collapse/Escape. Closing, returning to the list, or leaving the book unmounts its MapLibre instance. Expansion changes only panel dimensions; ResizeObserver resizes the same canvas, preserving the camera and terrain mode. Expanded views remain non-modal and retain the shared reader keyboard behavior. The expanded text view includes source links and the same confirmed place-deletion controls as the text dialog. Left/right arrows always turn book pages, including when the miniature canvas or its buttons have focus. The miniature disables built-in map keyboard navigation; mouse/touch gestures and its zoom controls remain available. Editing fields and modal dialogs retain their own keys, and map zoom shortcuts do not zoom the book. The launcher shares one rounded capsule with two distinct 21px outline icons and separate 44px pointer targets. Merely opening a book or listing maps does not load MapLibre or allocate another WebGL context.

`GET /api/books/:id/atlas` lists successful private saved results, including historical cache formats and expired inference results. It checks authentication and book ownership, paginates R2 entries, and never downloads the EPUB or calls AI. The client deduplicates by image digest, preferring the latest result, then matches original image bytes to parsed EPUB image blocks. This survives archive repacking/path changes and resolves every image occurrence. Unmatched images are omitted instead of inventing anchors. Successful recognition in the full Atlas updates the launcher immediately; a new book/session has its own list.

Validation: `node --test web/src/atlas/savedMaps.test.ts web/src/atlas/catalog.test.ts`, worker Atlas tests, and `web/scripts/check-atlas-dock.mjs`. The browser test intercepts every API with a fixture account and EPUB: no actual AI calls or account writes. It checks hidden empty state, live recognition, reload restoration, source anchors, panel size, no duplicate inference, keyboard isolation, mobile bounds, and cleanup. Set `READER_URL` to the build/production URL and `PUPPETEER_CORE` if Puppeteer is not installed locally.

Text results use the same authenticated, paginated GET as image maps. The reader unions saved passage results with freshly recognized results; legacy text caches are included regardless of gazetteer version. No aggregate R2 object is overwritten, so concurrent generation cannot lose another passage’s places. Failed/running/unresolved-only jobs are excluded. Reopening either the miniature or expanded text map never sends a POST or calls AI. Source attribution remains available in the expanded view. Book/account switches reset the dock; online/focus refresh recovers saved results.

On touch/phone reading layouts the dock is available when reading controls are visible, and remains available while its panel is open. It sits above the bottom reading toolbar; closing the controls and panel restores immersive reading. Both selection and annotation toolbars wrap within narrow viewports so the map action remains reachable.

When a confirmed text-recognition request completes, a result explanation first
lists the recognized names, matched names, countries, coordinates, sources, and
unresolved names. It creates no second map and leaves the dock unchanged while
the user reviews the result. Clicking “View on map” merges the result into the
book-wide pins, switches the dock to text places, and
its camera centers on the first newly added place from that passage (or the first
returned place if all were already saved), selecting its pin and zooming to at
least level 9. Other pins remain on the map. The confirmation
window closes without mounting a second map. Dock size is preserved. With the
dock closed, a successful result opens the dock expanded, including the first
recognized place in a book that previously had no map launcher. Unresolved results
and errors remain visible in the confirmation dialog; they do not replace the
existing map. Closing the completed review updates the cache without explicitly
opening or refocusing the dock. Dismissing an in-flight dialog still saves its eventual result but
does not reopen UI. The owner check prevents a late result from appearing in a
different book or account. No resize or cached view starts an AI request.

2026-11-14 verification: the browser regression passed on desktop and phone
fixtures, including fixed left/bottom anchor, larger dimensions, shrink-to-original
bounds, identical canvas identity across expansion, inline text-result handoff,
late cached completion after dismissal, unresolved-result preservation, source
list layout, confirmed deletion, retries, reload persistence and last-place
cleanup. All API calls were intercepted (no paid inference). Six map catalog/
saved-map unit tests, production build and lint passed; lint has three existing
warnings. The shared `TextAtlasPlaces` component keeps deletion behavior identical
in the dialog and dock rather than duplicating its request/confirmation state.

Deployed to `ereader.space` as Worker version
`worker-version-id` (100% traffic). Live verification opened
the signed-in book's 38 cached text places, expanded and shrank the dock without
an open dialog, and confirmed the same left/bottom anchor and exact restoration
of the original bounds. A final screenshot records the expanded dock. Generation
handoff was verified with intercepted browser fixtures, not a paid production call.

Closed-dock follow-up: successful confirmed text results now open the expanded
dock directly, with the book-wide pins and camera focused on one place from the current passage.
Deleting the last visible place closes the emptied dock so a later dismissed
request cannot resurrect its stale expanded state. Browser regression covers
first-place presentation without a launcher, closed-dock cached results,
preserving an already-open dock's size, and dismissed completion staying closed.
Build and lint passed (three pre-existing lint warnings); fixture requests did
not call production AI.
Released as `worker-version-id` at 100% traffic. The production
ReaderWorkspace asset's SHA-256 matches the local verified build.

Single-place focus regression: browser assertions check the selected pin's actual
screen position against the map center and a local-distance scale, including an
old first/new second result, all-cached refocus after switching to the globe, and
multiple new places on phone. All returned pins remain mounted. Terrain and
OpenFreeMap requests are deliberately blocked in this UI suite to exercise the
bundled-map fallback without waiting for external providers; no production AI is
called. Build and lint pass with the same three existing lint warnings.
Deployed as `worker-version-id` at 100% traffic; production
AtlasMap and ReaderWorkspace SHA-256 hashes match the tested local build.

Result-review follow-up: completed recognition now explains each matched place
before the explicit “View on map” action. The browser regression verifies the
review list, unresolved names, mobile bounds, a closed dock staying closed and an
open dock staying unchanged during review, followed by the existing focused-pin
handoff. Reviewing and viewing cached results add no inference. The full fixture
suite passed; the first run timed out in an earlier image-map loading step and
the rerun passed. Production build and lint passed with the same three existing
warnings. No production AI requests were used for verification.

Deployed as `worker-version-id` at 100% traffic. The
production ReaderWorkspace JavaScript and CSS SHA-256 hashes match the tested
local build.

2026-11-15 capsule release: `worker-version-id`, 100% traffic.
Build, lint (three existing warnings) and the updated browser fixture suite passed.
The suite checks image-only/text-only availability, image-only list contents,
direct text-map opening, switching categories, mobile bounds and prior focus,
cache and deletion behavior. The 50px capsule's height is included in panel
clearance limits. In the signed-in production book, the left shortcut showed two
image entries and the right shortcut directly opened the saved text map with
Tehran's pin. No recognition request was made during live verification.
The production ReaderWorkspace asset hash matched the tested build.
