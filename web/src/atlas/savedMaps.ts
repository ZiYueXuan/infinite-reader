import type { ParsedBook } from '../book/types'
import type { BookMap } from './catalog'

export interface LocatedMap { map: BookMap; path: string; chapter: number; block: number }

export function mapAnchors(book: ParsedBook, path: string, map: BookMap): LocatedMap[] {
  return book.chapters.flatMap((chapter, index) => chapter.blocks.flatMap((block, i) =>
    block.img?.path === path ? [{ map, path, chapter: index, block: i }] : []))
}

/** Match saved content identities, including repacked books with renamed image paths. */
export async function locateSavedMaps(book: ParsedBook, maps: BookMap[], signal: AbortSignal): Promise<LocatedMap[]> {
  if (!maps.length) return []
  const byDigest = new Map(maps.map(map => [map.image.sha256, map]))
  const sizes = new Set(maps.map(map => map.image.bytes))
  const paths = new Set(book.chapters.flatMap(ch => ch.blocks.flatMap(b => b.img ? [b.img.path] : [])))
  const found: LocatedMap[] = []
  for (const path of paths) {
    signal.throwIfAborted()
    // One missing/corrupt archive image must not hide other saved maps.
    const image = await book.getImage(path).catch(() => null)
    if (!image || !sizes.has(image.size)) continue
    const digest = await crypto.subtle.digest('SHA-256', await image.arrayBuffer())
    signal.throwIfAborted()
    const map = byDigest.get([...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join(''))
    if (map) found.push(...mapAnchors(book, path, map))
  }
  return found
}

export function mergeLocatedMaps(previous: LocatedMap[], incoming: LocatedMap[]): LocatedMap[] {
  const entries = new Map(previous.map(entry => [`${entry.chapter}:${entry.block}`, entry]))
  for (const entry of incoming) entries.set(`${entry.chapter}:${entry.block}`, entry)
  return [...entries.values()].sort((a, b) => a.chapter - b.chapter || a.block - b.block)
}
