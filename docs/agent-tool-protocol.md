# Agent tool-call text recovery

The reported answer contained a DeepSeek DSML `calls` envelope in the assistant's
text channel. The OpenAI-compatible Pi adapter only treated structured `tool_calls`
as calls, so the envelope was displayed as prose and no passage was read.

The provider adapter now normalizes complete DSML envelopes into Pi tool calls.
It buffers protocol prefixes across stream chunks, validates names and arguments
against the active tool definitions, and hands execution to the existing harness.
Native tool calls remain unchanged. Both Unicode and ASCII DSML delimiters are
accepted. Malformed, truncated, quoted, unknown or disallowed calls fail with
`llm_tool_protocol`; mixed native/DSML calls are rejected to avoid duplicate work.
No extra retry or model call is added. Existing authorization, tool/model budgets,
usage accounting, cancellation and durable replay remain in force.

This conversion applies only to the current provider response, never user input,
book text, tool results or saved history. The UI also hides protocol markup in old
saved answers and identifies those answers as interrupted; it does not rerun them.

The screenshot also exposed a context ambiguity: a right-page selection could be
sent alongside the left page's reading position. The client now sends the selected
passage's position. `read_book_passage` accepts its EPUB path and resolves it within
the authorized book, taking precedence over a conflicting numeric reader index.
An absent or ambiguous path returns a tool error instead of guessing another
chapter. Prompts distinguish server indexes, reader indexes and printed chapter
numbers, and ask the model to verify passage text because parser offsets can differ.

Regression coverage includes character-by-character DSML streaming, real harness
tool execution and a cited follow-up answer, persisted history, usage records,
malformed-call errors, path/index disagreement, right-page selection context, and
saved-answer rendering. Model responses are mocked: tests do not spend API credits
or change production user conversations. Upstream generation remains variable;
unsupported protocol variants fail explicitly rather than being executed loosely.
