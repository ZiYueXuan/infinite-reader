import { t } from '../i18n/runtime.ts'
import { loadPrefs } from '../settings'
import { ensureBookFonts, readerFontFamily, quoteFontFamily } from './fonts'
import '@fontsource-variable/eb-garamond'
import '@fontsource-variable/eb-garamond/wght-italic.css'
import '@fontsource-variable/caveat'
import '@fontsource-variable/inter'
import { makeCover } from '../engine/cover'
import { identifyBookMap, type BookMap } from '../atlas/catalog'
import type { LoadedBook } from '../engine/scene'
import { parseEpub } from './epub'
import { DEFAULT_LAYOUT, paginate, type LayoutConfig } from './layout'
import type { ParsedBook } from './types'

export async function ensureFonts() {
  await Promise.all([
    document.fonts.load('440 22px "EB Garamond Variable"'),
    document.fonts.load('italic 440 22px "EB Garamond Variable"'),
    document.fonts.load('660 22px "EB Garamond Variable"'),
    document.fonts.load('italic 660 22px "EB Garamond Variable"'),
    document.fonts.load('600 40px "Caveat Variable"'),
    document.fonts.load('440 14px "Inter Variable"'),
  ])
}

export interface Prepared {
  parsed: ParsedBook
  loaded: Omit<LoadedBook, 'id' | 'turned'>
  coverDataUrl?: string
}

async function blobToDataUrl(b: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(b)
  })
}

async function thumb(blob: Blob) {
  const bmp = await createImageBitmap(blob)
  const s = 220 / Math.max(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * s)
  c.height = Math.round(bmp.height * s)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.8)
}

export async function prepareBook(
  data: Blob | ArrayBuffer,
  cfg: LayoutConfig = DEFAULT_LAYOUT,
  onProgress?: (p: number, label: string) => void,
): Promise<Prepared> {
  onProgress?.(0.02, t("Opening EPUB"))
  await ensureFonts()
  const parsed = await parseEpub(data)
  const { readerFont: fontId, quoteFont } = loadPrefs()
  onProgress?.(0.15, t("Loading typeface"))
  const fonts = await ensureBookFonts(fontId, parsed.chapters.map((ch) => ch.blocks.map((b) => b.text).join('')).join('') + parsed.meta.title + parsed.meta.author, [], { id: quoteFont, book: parsed })
  cfg = { ...cfg, family: readerFontFamily(fontId), quoteFamily: quoteFontFamily(quoteFont) }
  onProgress?.(0.2, t("Typesetting"))
  const pag = await paginate(parsed, cfg, (p) => onProgress?.(0.2 + p * 0.65, t("Typesetting")))
  pag.fonts = fonts
  onProgress?.(0.88, t("Binding"))
  const images = new Map<string, ImageBitmap>()
  const maps = new Map<string, BookMap>()
  const paths = new Set<string>()
  for (const ch of parsed.chapters) for (const b of ch.blocks) if (b.img) paths.add(b.img.path)
  for (const p of paths) {
    const blob = await parsed.getImage(p)
    if (blob) {
      try {
        images.set(p, await createImageBitmap(blob))
        const map = await identifyBookMap(blob)
        if (map) maps.set(p, map)
      } catch {
        /* skip */
      }
    }
  }
  let coverBmp: ImageBitmap | null = null
  let coverDataUrl: string | undefined
  if (parsed.cover) {
    try {
      coverBmp = await createImageBitmap(parsed.cover)
      coverDataUrl = await thumb(parsed.cover)
    } catch {
      coverDataUrl = await blobToDataUrl(parsed.cover).catch(() => undefined)
    }
  }
  const cover = makeCover(parsed.meta.title, parsed.meta.author, coverBmp, cfg.family)
  onProgress?.(1, t("Ready"))
  return {
    parsed,
    coverDataUrl,
    loaded: { title: parsed.meta.title, author: parsed.meta.author, pag, images, cover, maps },
  }
}
