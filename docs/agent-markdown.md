# Agent response Markdown

Agent history and live responses use `react-markdown` with the CommonMark parser and `remark-gfm`. The old emphasis-only regular-expression renderer has been removed.

Agent emphasis also uses the parse-only `remark-cjk-friendly` extension. This recognizes delimiters next to CJK text and punctuation, for example `也可以看出**“联队”是核心战术单位**`, which plain CommonMark treats as literal text. The source is not rewritten, so code, escapes and citation offsets retain their meaning. The same parser handles saved history and streaming answers.

Supported syntax includes headings (ATX and Setext), paragraphs and hard breaks, nested ordered/unordered lists, emphasis, strikethrough, blockquotes, thematic breaks, escaped characters/entities, links/reference links/autolinks, images, fenced/indented/inline code, GFM tables with alignment, task lists and footnotes. Safe embedded HTML (such as details/summary, sub/sup and tables) is sanitized before rendering. Active HTML, scripts, event handlers, arbitrary CSS and unsafe URL schemes are not executed.

Math uses `$…$` and `$$…$$` through KaTeX with trust disabled and expansion/size limits. Fenced `mermaid` blocks render after streaming completes; Mermaid loads on demand in strict mode and the resulting SVG is displayed as an inert image. Invalid or unsupported diagram syntax keeps the original source available. These are explicit extensions to Markdown, not a promise to implement every proprietary Markdown dialect.

Wide tables and code scroll within the answer rather than widening the Agent panel. Code blocks have a copy control and syntax highlighting for registered languages; unknown language names remain readable as plain code. The Markdown/CSS bundle loads only when an answer is displayed; diagram engines load only when needed.

Book citations are added after parsing and sanitization, only for source numbers with validated passage targets. They continue to navigate to the original text, including citations in headings, lists, tables and emphasis. Code, existing links, math and escaped references are left alone. Footnote/HTML IDs and local fragment links are scoped to each message, and footnote clicks scroll inside the conversation without altering the reader's passage URL.

Validation: `answerText.test.ts` exercises the actual parsing pipeline, nested structures, citations, footnotes, math, sanitization and every prefix of a streamed example. `web/scripts/check-agent-markdown.mjs` exercises the real Agent UI with intercepted history/stream fixtures, copy controls, diagrams, source navigation and desktop/mobile overflow. No real AI requests are needed.
