import { setLocale, type Locale } from '../i18n/runtime.ts'
import type { Annotation } from './annotations'
import type { LayoutConfig, Page } from './layout'
import { renderPage } from './pageRender'

import type { FontAsset } from './fontCatalog'
export type FontSpec = FontAsset

export type ToWorker =
  | { t: 'init'; fonts: FontSpec[]; locale: Locale }
  | {
      t: 'render'
      id: number
      page: Page
      cfg: LayoutConfig
      scale: number
      title: string
      author: string
      marks: Annotation[]
      images: Record<string, ImageBitmap>
    }

export type FromWorker = { t: 'ready' } | { t: 'done'; id: number; bitmap: ImageBitmap } | { t: 'fail'; id: number }

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
  postMessage(msg: FromWorker, transfer?: Transferable[]): void
  fonts: FontFaceSet
}
const scope = self as unknown as WorkerScope
let ready: Promise<void> = Promise.resolve()

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.t === 'init') {
    setLocale(m.locale)
    ready = Promise.all(
      m.fonts.map(async (f) => {
        try {
          const face = new FontFace(f.family ?? 'EB Garamond Variable', `url(${f.url})`, { weight: f.weight ?? '400 800', style: f.style, unicodeRange: f.range })
          scope.fonts.add(await face.load())
        } catch (error) {
          // Custom fonts must match main-thread measurement; use the main-thread fallback on failure.
          if (f.family) throw error
        }
      }),
    ).then(() => {
      scope.postMessage({ t: 'ready' } satisfies FromWorker)
    })
    void ready.catch(() => { scope.postMessage({ t: 'fail', id: -1 }) })
    return
  }
  void (async () => {
    try {
      await ready
      const images = new Map(Object.entries(m.images))
      const canvas = renderPage(m.page, { cfg: m.cfg, scale: m.scale, bookTitle: m.title, author: m.author, marks: m.marks, images })
      const bitmap = await createImageBitmap(canvas as OffscreenCanvas, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })
      scope.postMessage({ t: 'done', id: m.id, bitmap } satisfies FromWorker, [bitmap])
    } catch {
      scope.postMessage({ t: 'fail', id: m.id } satisfies FromWorker)
    }
  })()
}
