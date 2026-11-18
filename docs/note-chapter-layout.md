# Inline note commit latency

Closing a changed note previously measured and paginated every chapter again. In a
book with thousands of chapters, the paginator's cooperative timer yields alone
added seconds. This was separate from opening the editor, which already happened
without waiting for pagination.

The paginator now retains chapter layouts in a WeakMap keyed by its result. A note
commit reuses unchanged chapters and copies page shells before updating global page
numbers. It still rebuilds global navigation and footnote reference indexes. Book,
layout configuration, locale, and changes to visible footnote definitions invalidate
the appropriate cache. Font preparation examines note content and retains existing
body font assets instead of rescanning the entire book.

Replacing the book model also disposed all paper materials before rendering their
replacements. This released shared Three.js GPU programs and forced recompilation.
Reflow now retires the old model after the replacement's first render, with disposal
in a finally block. The old model is removed from the scene immediately.

Validation:

- `check-note-chapter-layout.mjs` compares incremental results with fresh pagination
  for insertion, editing, long continuations, Markdown, tags, deletion, hidden
  footnote definitions, and font size changes. It checks old snapshot immutability,
  offset navigation, and reuse of unaffected chapter geometry.
- `check-note-open-performance.mjs` uses a local synthetic 500,000-character book,
  exercises the actual editor and Done button, and checks rendered note targets,
  shared GPU program identity, stale-layout cancellation, and unchanged-note closes.
- A local copy of the reported book contains 1,481,116 characters, 2,323 parsed
  chapters, and 5,994 pages. No cloud annotations are changed by this reproduction.

These optimizations do not make a changed chapter constant-time: unusually large
individual chapters and long notes still need layout work. Browser paint/compositor
latency is separate from the measured layout and synchronous render duration,
especially when headless Chromium uses software WebGL.
