# Sticky-note text regression — 2026-10-26

The old Canvas wrapper split only on whitespace, so an unspaced Chinese sentence was drawn beyond the paper edge. The editor also combined Caveat punctuation with platform-dependent Chinese fallback glyphs.

- Shared note typography: Chinese notes use LXGW WenKai 500, including punctuation; English notes retain Caveat. Editor and desktop share line-height and font selection.
- Grapheme-safe wrapping respects word boundaries, explicit newlines and punctuation. Desktop sheets and closed-book tabs share wrapping/ellipsis helpers.
- Font subsets load through the existing cached loader; textures refresh after loading. Stale requests and disposed notes cannot repaint. Font download failure retains fallback text.
- Note storage and original text are unchanged.

Validation:
- `node --experimental-strip-types --test web/src/engine/noteText.test.ts web/src/ui/noteEditorLayout.test.ts`: 7 passed.
- Web production build passed. Lint: only the 3 existing warnings.
- Built-in browser, `web/scripts/note-text-check.html`: actual NoteEditor and NoteObject textures; Chinese, English, mixed emoji/newlines, long text ellipsis, input → Done. Fixture blocks API/external fetch and uses no user storage.
- Production existing note `注意：这里说的是“力量”，而不是“智慧”！`: opened without modifying text, then Done. Full sentence wraps on desktop, including final punctuation.
- Cloudflare version `worker-version-id`; live `ereader.space` serves `index-Cf0SCZWb.js`, SHA-256 matches local build (`ae644bcb1180edb9ebdf493b7f2738804c77b56c42e89dd05e849de9267983d9`).
- Screenshots: `/tmp/infinite-reader-note-text-fixed.png` (local comparison), `/tmp/infinite-reader-note-live-fixed.png` (production after Done).
