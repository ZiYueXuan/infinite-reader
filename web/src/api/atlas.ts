import type { TextAtlasResult } from '../../../shared/textAtlas'
import type { AtlasRecognition, BookMap } from '../../../shared/atlas'
import { api, jsonBody } from './http'

export function recognizeBookMap(bookId: string, path: string, refresh: boolean, signal: AbortSignal) {
  return api<AtlasRecognition>(`/books/${encodeURIComponent(bookId)}/atlas`, {
    method: 'POST', body: jsonBody({ path, refresh }), signal,
  })
}

export async function savedBookAtlas(bookId: string, signal: AbortSignal): Promise<{ maps: BookMap[]; textMaps: TextAtlasResult[]; excludedPlaceIds: string[] }> {
  const textMaps: TextAtlasResult[] = []
  const excluded = new Set<string>()
  const maps = new Map<string, { map: BookMap; recognizedAt: number }>()
  let cursor: string | null = null
  do {
    const page: { excludedPlaceIds?: string[]; textMaps?: TextAtlasResult[]; maps: { map: BookMap; recognizedAt: number }[]; cursor: string | null } = await api(
      `/books/${encodeURIComponent(bookId)}/atlas${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    for (const entry of page.maps) {
      const previous = maps.get(entry.map.image.sha256)
      if (!previous || entry.recognizedAt > previous.recognizedAt) maps.set(entry.map.image.sha256, entry)
    }
    textMaps.push(...(page.textMaps ?? []))
    for (const id of page.excludedPlaceIds ?? []) excluded.add(id)
    cursor = page.cursor
  } while (cursor)
  return { maps: [...maps.values()].map(entry => entry.map), textMaps, excludedPlaceIds: [...excluded] }
}

export function deleteTextPlace(bookId: string, placeId: string) {
  return api<{ deletedPlaceId: string }>(`/books/${encodeURIComponent(bookId)}/text-atlas/places/${encodeURIComponent(placeId)}`, {
    method: 'DELETE', body: jsonBody({ confirmed: true }), signal: AbortSignal.timeout(30_000),
  })
}
