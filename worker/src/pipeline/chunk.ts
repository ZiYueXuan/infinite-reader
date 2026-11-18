export interface Chunk {
  start: number;
  end: number;
  text: string;
}

export interface ChunkOptions {
  target?: number;
  max?: number;
  overlap?: number;
}

interface Unit {
  start: number;
  end: number;
}

const SENTENCE = /[^。！？!?.\n]+(?:[。！？!?]+|\.(?=\s|$))*["”’)）」』]*\s*/g;

/** Split text into units (paragraphs; oversize paragraphs are split into sentences, then hard-wrapped). */
function toUnits(text: string, max: number): Unit[] {
  const units: Unit[] = [];
  const para = /[^\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = para.exec(text))) {
    const pStart = m.index;
    const pEnd = pStart + m[0].length;
    if (pEnd - pStart <= max) {
      units.push({ start: pStart, end: pEnd });
      continue;
    }
    const slice = m[0];
    SENTENCE.lastIndex = 0;
    let s: RegExpExecArray | null;
    let covered = 0;
    while ((s = SENTENCE.exec(slice))) {
      if (s[0].length === 0) {
        SENTENCE.lastIndex++;
        continue;
      }
      pushWrapped(units, pStart + s.index, pStart + s.index + s[0].length, max);
      covered = s.index + s[0].length;
    }
    if (covered < slice.length) pushWrapped(units, pStart + covered, pEnd, max);
  }
  return units;
}

function pushWrapped(units: Unit[], start: number, end: number, max: number) {
  for (let s = start; s < end; s += max) units.push({ start: s, end: Math.min(end, s + max) });
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.target ?? 900;
  const max = opts.max ?? 1200;
  const overlap = opts.overlap ?? 120;
  const units = toUnits(text, max);
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < units.length) {
    let j = i;
    let start = units[i]!.start;
    let end = units[i]!.end;
    while (j + 1 < units.length && units[j + 1]!.end - start <= max && end - start < target) {
      j++;
      end = units[j]!.end;
    }
    const body = text.slice(start, end).trim();
    if (body.length > 0) chunks.push({ start, end, text: body });
    if (j + 1 >= units.length) break;
    // Start the next chunk with trailing units of this one, up to `overlap` chars, but always make progress.
    let k = j + 1;
    let ov = 0;
    while (k - 1 > i && ov + (units[k - 1]!.end - units[k - 1]!.start) <= overlap) {
      k--;
      ov += units[k]!.end - units[k]!.start;
    }
    i = k;
  }
  return chunks;
}
