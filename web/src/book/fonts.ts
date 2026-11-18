import { t } from '../i18n/runtime.ts'
import { noteFontIdOf, type NoteFontId } from './noteFontCatalog'
import type { Annotation } from './annotations'
import { READER_FONTS, fontAssetsFromCss, fontRangeIntersects, type FontAsset, type ReaderFontId, type QuoteFontId } from './fontCatalog'
import { isSourceQuote } from './typography'
import type { ParsedBook } from './types'
import { SERIF_STACK, clearMeasureCache } from './layout'
import { createFontDownloadCache, fetchFontBytes } from './fontDownloads'

const cssLoaders = {
  'noto-serif': () => import('@fontsource-variable/noto-serif-sc/index.css?inline'),
  'noto-sans': () => import('@fontsource-variable/noto-sans-sc/index.css?inline'),
  'wenkai': () => import('../assets/wenkai/500.css?inline'),
  'ma-shan-zheng': () => import('@fontsource/ma-shan-zheng/index.css?inline'),
  'long-cang': () => import('@fontsource/long-cang/index.css?inline'),
  'zhi-mang-xing': () => import('@fontsource/zhi-mang-xing/index.css?inline'),
  'caveat': () => import('@fontsource-variable/caveat/index.css?inline'),
  'xiaowei': () => import('@fontsource/zcool-xiaowei/index.css?inline'),
}
const loadFace = createFontDownloadCache<FontAsset>(async (url, asset) => {
  let bytes: ArrayBuffer
  try { bytes = await fetchFontBytes(url) }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(t("字体加载超时，请检查网络后重试。"))
    throw new Error(t("字体资源不可用，请重试。"), { cause: error })
  }
  const face = new FontFace(asset.family!, bytes, { weight: asset.weight, style: asset.style, unicodeRange: asset.range })
  await face.load()
  document.fonts.add(face)
})

export function readerFontFamily(id: ReaderFontId) {
  return id === 'classic' ? SERIF_STACK : `"${READER_FONTS.find((f) => f.id === id)!.family}", ${SERIF_STACK}`
}

export function quoteFontFamily(id: QuoteFontId) {
  return id === 'inherit' ? undefined : readerFontFamily(id)
}

async function ensureQuoteFont(id: QuoteFontId, book: ParsedBook): Promise<FontAsset[]> {
  if (id === 'inherit') return []
  const text = book.chapters.flatMap(ch => ch.blocks.filter(isSourceQuote).map(b => b.text)).join('')
  return text ? ensureReaderFont(id, text) : []
}

/** Load only the chosen face and subsets needed by this book, before measuring any text. */
export async function ensureReaderFont(id: ReaderFontId, text: string): Promise<FontAsset[]> {
  return id === 'classic' ? [] : ensureFont(id, text)
}

async function ensureFont(id: keyof typeof cssLoaders, text: string): Promise<FontAsset[]> {
  // Only the stylesheet import has a total deadline. A large Chinese book can need
  // many subsets: downloads have independent deadlines and a bounded shared queue.
  let timer: ReturnType<typeof setTimeout> | undefined
  let css: string
  try {
    css = await Promise.race([
      cssLoaders[id]().then(module => module.default),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t("字体加载超时，请检查网络后重试。"))), 30_000)
      }),
    ])
  } finally { clearTimeout(timer) }
  const codepoints = [...new Set(Array.from(text + '0123456789 Read on the desk 在桌面上阅读').map((c) => c.codePointAt(0)!))]
  const assets = fontAssetsFromCss(css).filter((asset) => fontRangeIntersects(asset.range, codepoints))
  if (!assets.length || assets.some((asset) => !asset.url || !asset.family)) throw new Error(t("字体资源不可用，请重试。"))
  await Promise.all(assets.map(asset => loadFace(asset.url, asset)))
  clearMeasureCache()
  return assets
}

/** Fonts and Unicode subsets must reach both the measuring canvas and page workers. */
export async function ensureInlineNoteFont(value: NoteFontId, text: string): Promise<FontAsset[]> {
  const id = noteFontIdOf(value)
  if (id === 'inherit') return []
  const assets = await ensureFont(id, text + t("写下你的想法…"))
  if (id === 'caveat') assets.push(...await ensureReaderFont('wenkai', text + t("写下你的想法…")))
  return assets
}

export async function ensureInlineNoteFonts(annotations: readonly Annotation[]): Promise<FontAsset[]> {
  const groups = new Map<NoteFontId, string[]>()
  for (const { note } of annotations) if (note) {
    const id = noteFontIdOf(note.font)
    if (id === 'inherit') continue
    const texts = groups.get(id) ?? []
    texts.push(note.text, ...(note.tags ?? []))
    groups.set(id, texts)
  }
  const assets = (await Promise.all([...groups].map(([id, texts]) => ensureInlineNoteFont(id, texts.join(' '))))).flat()
  return [...new Map(assets.map(asset => [asset.url, asset])).values()]
}

export async function ensureBookFonts(reader: ReaderFontId, text: string, annotations: readonly Annotation[], quote?: { id: QuoteFontId; book: ParsedBook }): Promise<FontAsset[]> {
  const assets = (await Promise.all([ensureReaderFont(reader, text), ensureInlineNoteFonts(annotations), quote ? ensureQuoteFont(quote.id, quote.book) : []])).flat()
  return [...new Map(assets.map(asset => [asset.url, asset])).values()]
}
