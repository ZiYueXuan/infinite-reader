import pairs from './data/han-spellings.json';

// Each entry has two Unicode code points, including supplementary-plane Han.
const toTraditional = new Map<string, string>();
const toSimplified = new Map<string, string>();
for (const [simple, traditional] of pairs) {
  toTraditional.set(simple, traditional);
  toSimplified.set(traditional, simple);
}

/** Only whole-name spellings using reversible character pairs, never word translations. */
export function alternateHanSpellings(name: string): string[] {
  if (!/^\p{Script=Han}+$/u.test(name)) return [];
  const characters = [...name];
  const spellings = [toTraditional, toSimplified].map(table => characters.map(c => table.get(c) ?? c).join(''));
  return [...new Set(spellings)].filter(spelling => spelling !== name);
}
