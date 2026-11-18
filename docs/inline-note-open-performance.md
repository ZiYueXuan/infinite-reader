# Inline note editor opening latency

The mark/selection toolbar used to await `editNote → reflowNotes` before publishing `editingNote`. This loaded book/note font subsets, paginated the entire book, and rebuilt the 3D book and textures, even for an unchanged existing note. API annotation writes already return after entering the durable outbox; a server round-trip was not the main gate.

A local Chromium/SwiftShader reproduction with roughly 502,000 characters took about 4 seconds from the toolbar click to an editable Milkdown surface. The note reflow occupied about 3.8 seconds, including a roughly 1.8-second main-thread task rebuilding the book. These are synthetic fixture measurements, not a trace from the reported user's book.

Opening now sets the editor state immediately, using the existing projected note rectangle or the selected passage's rectangle. Existing off-screen notes can still be revealed without repagination. New notes enter the page layout after Done (or the existing outside-click finish action); text continues to autosave while editing. Unchanged notes need no layout on close. Reopening cancels older pending note-layout results, and repeated Add calls cannot overwrite an existing draft with empty text. All editor entry paths use the same store action.

Validation:

- `web/scripts/check-note-open-performance.mjs` loads the full synthetic long book (2,108 pages) before measuring. The fixed editor opened in about 134 ms, and an existing note reopened in about 62 ms in the local run. Persistence was deliberately held; the editor remained usable, with no pagination or model replacement during entry/typing. Done lays out the note once; unchanged close and stale pending layouts do not rebuild it.
- `check-inline-notes.mjs` checks native text selection, immediate editing, insertion below the selected line on Done, source offset preservation, rendered content and note deletion.
- `check-note-editor.mjs` and `check-note-live-markdown.mjs` cover autosave/reload, editor resizing, Markdown/IME/selection behavior, and unchanged-note reopening.

This removes full-book layout from editor entry. Full pagination/model reconstruction after a note's layout changes still scales with book size; it is not made incremental by this change.
