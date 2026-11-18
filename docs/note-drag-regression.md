# Sticky note drag handles

## Cause and change

Book text is selectable through transparent DOM spans above the WebGL canvas. The old canvas-only pointer-down listener could not receive a note press when the note covered one of those spans.

The reader now hit-tests notes during capture on the common reader container, leaving uncovered text to native selection. A six-dot DOM handle follows each visible free note's projected top-left corner and stays above the text. The existing note movement and persistence callbacks are reused. A handle click does not edit the note; note-body clicks still do. Cancelled gestures do not open the editor, and a second touch releases the held note before pinch zoom takes over.

## Local acceptance (2026-10-27)

In the built-in browser, `web/scripts/note-link-check.html` uses synthetic book data and blocks external/API fetches.

- 19 overlay checks passed, including both note connectors and handle lifecycle (editing, modal, page turn, closed book, deletion).
- Placed notes over both left/right page text. Dragged left note out, back onto the page, out again; dragged right note out. Four movement callbacks, no text selection or mark-click callbacks.
- Dragged the note body over text: movement callback fired. Clicked another note body: editor hook fired and its handle disappeared.
- Double-clicked the handle: no editor, no page zoom. Ordinary text outside the note remained selectable.
- Frontend build and lint passed; lint retains three existing warnings in unrelated files.

The fixture's position-reset controls recreate their synthetic notes so cached mesh poses do not invalidate later regression runs. No user annotations are used by the fixture.

## Production acceptance

- Deployed Worker version: `worker-version-id`.
- `https://ereader.space` serves `/assets/index-ChM9rvw5.js` from this build.
- In the existing signed-in reader tab, five notes expose six-dot handles, including the blue note overlapping the book. Clicking that handle leaves the editor closed and text selection empty. User note positions were not changed by this live check.
- Screenshot: `/tmp/infinite-reader-note-handles-live.png`.

## Paper-relative handle update (2026-10-27)

The handle's placement, visible dots, and scale now follow local projected paper axes near its top-left corner. At very small scales only the transparent hit area expands, within a bounded area; the dots stay proportional. In the built-in browser the fixture passed 23 checks, including zoom in/out, a low viewing angle, and lifecycle checks. Dragging from the expanded target while zoomed out moved the synthetic note without selecting text. Build and lint passed with the same three unrelated warnings.

Production Worker version: `worker-version-id`; the signed-in reader displayed the new handles and the deployed asset `/assets/index-CiRoFHJ0.js`. The live check changed zoom temporarily and did not move user notes.

## Zoom immediately after dragging (2026-10-27)

The drag handle's `data-ui` parent caused wheel and WebKit gesture events on the handle to bypass the reader's zoom handler. The handle is now treated as part of the reading scene for zoom events only; other controls retain their existing event handling.

In the local browser fixture, synthetic Ctrl-wheel and gesture checks failed before the fix and passed afterward, as did ordinary wheel and unrelated UI checks. After dragging a synthetic note onto the page, a browser-delivered Ctrl-wheel at the handle changed reader zoom from 0.9 to 2.34 while `innerWidth`, `devicePixelRatio`, and `visualViewport.scale` remained unchanged. The 23 existing overlay checks and the frontend build/lint passed. The WebKit gesture stream was checked using synthetic events, not a physical Safari trackpad.

Production Worker version `worker-version-id` serves the matching asset `/assets/index-i4WO5Wqh.js`. On the signed-in reader, a browser-delivered Ctrl-wheel over a handle changed reader zoom while browser viewport and scale remained unchanged; user note positions were not modified.

## Inline-note and tag hover zoom (2026-10-30)

Inline-note edit targets and clickable tag targets also use `data-ui` to isolate clicks from source selection and page turns. They now share the note handle's exception in `isZoomUiTarget`, allowing the reader's non-passive wheel and Safari gesture handlers to own pan/zoom over their rendered ink. Actual editor controls and modal interaction suspension retain their existing behavior.

`web/scripts/check-note-zoom.mjs` uses a local sample and real projected hit targets. Its Ctrl-wheel assertion fails before the fix. Afterward, checks pass for Ctrl/Meta wheel, ordinary scroll pan, synthetic Safari gestures, duplicate pinch suppression, unrelated UI exclusion and modal suspension. Browser-delivered Ctrl-wheel over both note and tag targets changes reader zoom while `visualViewport.scale`, `innerWidth` and `devicePixelRatio` remain unchanged. No physical Safari device was used.
