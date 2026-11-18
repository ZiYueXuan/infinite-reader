# Inline note Markdown

Notes store their original Markdown in the existing `note.text` field. No database migration or AI request is involved. Existing notes are interpreted as Markdown when displayed; plain paragraphs and line breaks continue to work. Tags remain separate metadata, so a Markdown heading never creates a tag.

The editor opens in source mode, with an Edit / Preview switch. Both preview and book-page ink support CommonMark headings, emphasis, strong text, links and reference links, nested ordered/unordered lists, quotes, code, thematic breaks, plus GFM strikethrough, task lists, autolinks and tables. The tag overlay renders Markdown; the compact marks sidebar shows a plain summary.

Book-page notes use the existing canvas typography and pagination. Runs have no chapter offsets; rich formatting cannot shift source annotations or become selected book text. Tables wrap cells within the page; tables too wide for readable columns use stacked cells. Long notes continue onto subsequent pages. Changing only preview mode does not write data or repaginate.

Embedded HTML is displayed literally. External HTTP(S) and mailto links open separately, with no opener. Image syntax displays its alt text as a link rather than fetching or embedding a remote image. Math/LaTeX and Mermaid are not inline-note extensions. Code blocks are monospaced, without syntax highlighting.

Validation:

- `node --experimental-strip-types --experimental-specifier-resolution=node --test web/src/book/noteMarkdown.test.ts web/src/book/inlineNotes.test.ts web/src/book/footnoteLayout.test.ts web/src/ui/noteEditorLayout.test.ts`
- `web/scripts/check-note-markdown.mjs`: actual editor, canvas data, links, same-tag overlay, narrow viewport and unchanged Done behavior, using a local sample book.
- Existing `web/scripts/check-inline-notes.mjs`: fonts, colors, tags, deletion, persistence, continuation and no-flash saves.


The editor autosaves while typing. Local mode reports completion only after IndexedDB writes; cloud mode reports completion only for the latest acknowledged draft. Cloud updates use a 350 ms debounce with a 1.5 second maximum wait during continuous typing. Done flushes pending work immediately. Failed cloud writes stay in the existing outbox, can be retried from the editor, and replay on reconnection.

Drag the bottom-right handle to resize the editor; arrow keys also work. Double-click the handle (or press Enter/Space while it is focused) to reset its size. Preferred dimensions are stored on this device and clamped to the available viewport. Resizing and autosaving do not repaginate under the caret.
