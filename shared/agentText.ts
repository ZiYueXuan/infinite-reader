/** Match the namespace, including a recognizably truncated one at the end of a reply.
 * Display also hides malformed delimiters; the Worker separately validates executable calls. */
export function toolProtocolStart(text: string): number {
  return text.search(/<\/?[|｜]+DSML[|｜]|<\/?[|｜]+(?:DS|DSM|DSML)$/);
}

/** Keep a split protocol prefix out of streamed text, including before its name arrives. */
export function visibleAnswer(text: string, final = false): string {
  const at = toolProtocolStart(text);
  if (at >= 0) return final ? text.slice(0, at).trimEnd() : text.slice(0, at);
  if (final) return text;
  const pending = text.search(/<\/?(?:[|｜]+D?)?$/);
  return pending < 0 ? text : text.slice(0, pending);
}

