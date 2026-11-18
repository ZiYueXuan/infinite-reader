import { describe, expect, it } from 'vitest';
import { databaseUnavailable } from '../src/lib/databaseErrors';

describe('database availability classification', () => {
  it('recognizes service failures, including wrapped D1 errors', () => {
    const error = new Error('D1_ERROR: internal error; reference = diagnostic-reference');
    expect(databaseUnavailable(error)).toBe(true);
    expect(databaseUnavailable(new Error('Request failed', { cause: error }))).toBe(true);
  });
  it('does not label SQL bugs or constraint violations as a temporary outage', () => {
    for (const message of ['D1_ERROR: UNIQUE constraint failed: users.email', 'D1_ERROR: no such table: users', 'D1_ERROR: near SELECT: syntax error', 'Network connection lost']) {
      expect(databaseUnavailable(new Error(message))).toBe(false);
    }
  });
});
