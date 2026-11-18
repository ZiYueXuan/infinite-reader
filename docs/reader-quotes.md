# EPUB source quotations

The reader recognizes XHTML `blockquote` elements during EPUB parsing. Nested wrappers retain one literary group. Quote paragraphs use 90% of the body font size and 84% of its line-box height, with inset text, paragraph spacing, a subtle wash and a left rule. Adjacent quoted prose blocks use a single gap of 0.16 body em instead of stacking their outer margins, including when the EPUB wraps each sentence in its own blockquote. The outer spacing against normal prose remains unchanged.

Decorations are attached to each source line in page-content coordinates and painted before user highlights and ink. They do not participate in line breaking or pagination. Each page fragment paints independently, and inserted inline notes interrupt the rule. Ordinary paragraphs, epigraphs and verse retain their existing presentation. No quotation is inferred from punctuation, indentation or book-specific Calibre class names.

Quoted prose defaults to italic LXGW WenKai, independently of the body font. The italic treatment also applies when following the body font; explicit code and preformatted text retain their source styling. Appearance → Quotation font also offers “Follow body font”. This preference is saved locally, including when chosen from the shelf. Only characters in source quotations require the extra font subsets; the loaded faces are sent to page-rendering workers along with the body and note fonts. Note edits retain already-loaded quote faces without rescanning the book.

Legacy `<tt>` wrappers in quoted prose no longer force a system monospace font. Explicit `code`, `pre`, `kbd` and `samp` content remains monospace, including inside quotations. Font changes can change pagination, but preserve source text, IDs and character offsets. `web/scripts/check-quote-fonts.mjs` verifies both font modes and saved preferences through the real reader's font-switching flow with a nested-quotation EPUB fixture; optionally set `EPUB_FILE` to the supplied book to check its original chapter.

The supplied *抗日战争* EPUB confirms the reported passage in `index_split_005.html` has this structure:

```html
<blockquote class="calibre_9"><blockquote class="calibre_10">
  <tt class="calibre1"><span class="calibre_11">兹所谓满蒙者，…</span></tt>
</blockquote></blockquote>
```

Validation includes `quoteLayout.test.ts` for page continuations, source offsets, cache reuse, ordinary text and inline-note interruptions. A local browser comparison of the supplied chapter before/after the change confirmed identical parsed source and pagination after excluding the new decoration metadata, and verified that the actual quote paints the wash/rule. The uploaded EPUB is not part of the repository.
