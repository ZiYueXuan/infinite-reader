# Inline note editor: Milkdown

Evaluated on 2026-11-02 (Asia/Shanghai). The previous editor used CodeMirror for source editing and React Markdown for inactive blocks. Our custom block replacement and bullet widgets created two different list layouts, causing indentation and wrapping changes on focus transitions.

## Candidates

| Project | License | Fit |
| --- | --- | --- |
| [Milkdown](https://github.com/Milkdown/milkdown) 7.23.0 | [MIT](https://github.com/Milkdown/milkdown/blob/main/LICENSE) | Markdown-first editor on ProseMirror. CommonMark/GFM presets, native input rules, history, clipboard and native list nodes. Chosen. |
| [Vditor](https://github.com/Vanessa219/vditor) 4.0.1 | [MIT](https://github.com/Vanessa219/vditor/blob/master/LICENSE) | Closest to Typora-style instant rendering. Local IR and WYSIWYG trials kept `- ` as text until another character was typed, unlike the requested immediate space trigger. Also needs self-hosted Lute/language assets. |
| [MDXEditor](https://github.com/mdx-editor/editor) 4.3.4 | MIT, documented in repository README | React component with Markdown/JSX authoring. A viable alternative, but JSX authoring is unnecessary for plain notes. Not integrated or browser-tested in this comparison. |

## Integration boundaries

- Milkdown owns the document, Markdown parsing/serialization, typing rules, lists, caret, composition, clipboard, tables and undo/redo. Its native list schema renders semantic lists; CSS supplies task marker glyphs. The optional Vue list component is excluded because its delayed selection restoration could move the caret during consecutive edits. App code supplies typography and storage integration, not an alternative list parser or focus-dependent renderer.
- This is in-place rich editing: formatting stays rendered while editing. It replaces the earlier convention of exposing active-block source markers.
- Existing Markdown is not reserialized on open, focus, selection, language changes, or unchanged close. After an actual edit, Milkdown serializes Markdown using its standard formatting (for example, list markers or reference-link syntax may normalize). No database migration or AI calls are involved.
- Updates reach the existing note store synchronously; the existing autosave/cloud queue handles persistence. Escape and Ctrl/Cmd+Enter keep their existing close behavior and do not interrupt IME composition.
- The 10,000-character storage limit is enforced before accepting an editing transaction. External document updates are excluded from undo history.
- Raw HTML is inert text. Images render as safe links, preserving the existing no-remote-image-fetch policy. Unsupported legacy documents fall back to their intact Markdown source instead of silently losing content.
- The editor and dependencies are bundled locally. No editor CDN, paid editor service, or model inference is involved. MIT/BSD notices are shipped in `web/public/licenses/milkdown-notices.txt`.

## Validation

`web/scripts/check-note-live-markdown.mjs` exercises the real inline-note window with native keyboard and Chromium IME events. It checks a literal minus, immediate conversion after space, nested lists, Enter continuation/exit, and pixel geometry for wrapped list text across focus transitions at desktop and mobile widths. It also checks existing Markdown, tables, safe HTML/image handling, autosave, last-keystroke retention, history, lifecycle, locale changes and unchanged-close behavior.
