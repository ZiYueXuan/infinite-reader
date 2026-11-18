# Sticky-note connectors

A decorative SVG layer links each visible desktop note to the nearest visible line of its annotation. Both endpoints project the actual curved page/note geometry into the reader container. Stroke width and dash spacing remain constant in screen pixels.

- Only visible passages on the open spread are eligible; no link to an off-page passage.
- Note dragging, camera zoom/pan/tilt and page-edge peels update endpoints independently of the text selection overlay.
- Turning/closing the book, modal previews, editing a note, or removing its note hides the appropriate links.
- Overlapping/touching projected sheets and gaps below 8px are hidden.
- SVG uses `pointer-events: none` and is hidden from accessibility; no new data or AI requests.

Validation:
- `node --experimental-strip-types --test web/src/engine/noteConnectorGeometry.test.ts`: 5 passing tests for relative directions, rotated geometry, nearest line, overlap and invalid/degenerate inputs.
- Built-in browser, `web/scripts/note-link-check.html`: 11 passing scene checks covering two-page links, zoom, low camera angle, edit/Done, modal suspension, turn-in-progress, off-page hiding, return-to-page, closing and note removal.
- Real mouse drag moved a note and updated its line; SVG did not intercept input.
- Visual checks on Limestone and Graphite surfaces.
- Production build and lint completed; lint retains only the three existing unrelated warnings.

Deployment verification:
- Worker version: `worker-version-id`, serving `ereader.space` and the existing workers.dev hostname.
- Live `/assets/index-Cbeu_-fc.js` exactly matches the local production build (SHA-256 `f0debfce086fb7ffc6634c7a8e9fe704084f45aa53a6ce49033bd191eeafbb73`).
- Built-in browser confirmed the existing purple note connects to its highlighted passage on the right page. The path disappears while editing and returns after Done; the overlay has `pointer-events: none`.
- Live screenshot: `/tmp/infinite-reader-note-link-live.png`.
