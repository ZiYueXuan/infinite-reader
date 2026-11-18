/** D1 transport/service failures are retryable; constraint and SQL errors are not. */
export function databaseUnavailable(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (/D1_(?:ERROR|EXEC_ERROR)/i.test(current.message) && /internal error|temporarily unavailable|overloaded|network connection lost|reset because its code was updated|exceeded.*(?:time|duration)/i.test(current.message)) return true;
  }
  return false;
}
