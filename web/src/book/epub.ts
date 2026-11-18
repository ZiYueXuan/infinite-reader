import { t } from '../i18n/runtime.ts'
import JSZip from 'jszip'
import { resolveFootnotes } from './footnotes'
import { annotateChapterOpening, annotateLiteraryBlocks, literaryRole } from './typography'
import type { Align, Block, BlockKind, Chapter, Footnote, ParsedBook, TextRun, TocItem } from './types'

/* ----------------------------- path helpers ----------------------------- */

function dirname(p: string) {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i + 1)
}

function resolvePath(base: string, href: string) {
  const clean = decodeURIComponent(href.split('#')[0])
  if (!clean) return ''
  const parts = (clean.startsWith('/') ? clean.slice(1) : dirname(base) + clean).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return out.join('/')
}

function parseXml(text: string, type: DOMParserSupportedType = 'application/xml') {
  const doc = new DOMParser().parseFromString(text, type)
  return doc
}

function parseMarkup(text: string): Document {
  const xml = parseXml(text, 'application/xhtml+xml')
  if (xml.getElementsByTagName('parsererror').length === 0) return xml
  return parseXml(text, 'text/html')
}

const local = (el: Element) => (el.localName || el.tagName).toLowerCase()

function children(el: Element, name?: string) {
  return Array.from(el.children).filter((c) => !name || local(c) === name)
}

function descendants(el: Element | Document, name: string) {
  return Array.from(el.getElementsByTagNameNS('*', name))
}

/* ---------------------------- tiny CSS support --------------------------- */

interface CssProps {
  align?: Align
  italic?: boolean
  bold?: boolean
  smallcaps?: boolean
  noIndent?: boolean
}

interface CssRule {
  tag?: string
  cls?: string
  props: CssProps
}

function parseDecls(body: string): CssProps {
  const props: CssProps = {}
  for (const decl of body.split(';')) {
    const [k, v] = decl.split(':').map((s) => s?.trim().toLowerCase())
    if (!k || !v) continue
    if (k === 'text-align') {
      if (v === 'center' || v === 'right' || v === 'left' || v === 'justify') props.align = v
    } else if (k === 'font-style') props.italic = v === 'italic' || v === 'oblique'
    else if (k === 'font-weight') props.bold = v === 'bold' || parseInt(v, 10) >= 600
    else if (k === 'font-variant') props.smallcaps = v.includes('small-caps')
    else if (k === 'text-indent') props.noIndent = /^0/.test(v)
  }
  return props
}

function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}@]+)\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    const props = parseDecls(m[2])
    if (!Object.keys(props).length) continue
    for (const sel of m[1].split(',')) {
      const mm = sel.trim().match(/^([a-z][a-z0-9]*)?(?:\.([\w-]+))?$/i)
      if (mm && (mm[1] || mm[2])) rules.push({ tag: mm[1]?.toLowerCase(), cls: mm[2], props })
    }
  }
  return rules
}

function styleFor(el: Element, rules: CssRule[]): CssProps {
  const tag = local(el)
  const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
  const out: CssProps = {}
  for (const r of rules) {
    if (r.tag && r.tag !== tag) continue
    if (r.cls && !classes.includes(r.cls)) continue
    Object.assign(out, r.props)
  }
  const inline = el.getAttribute('style')
  if (inline) Object.assign(out, parseDecls(inline))
  const align = el.getAttribute('align')?.toLowerCase()
  if (align === 'center' || align === 'right' || align === 'left' || align === 'justify') out.align = align
  return out
}

/* --------------------------- markup -> blocks ---------------------------- */

interface InlineStyle {
  footnote?: Footnote
  bold?: boolean
  italic?: boolean
  sup?: boolean
  mono?: boolean
  smallcaps?: boolean
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'hr', 'table',
  'tr', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'aside', 'dl', 'dt', 'dd',
  'nav', 'body', 'tbody', 'thead', 'tfoot', 'td', 'th', 'main', 'address',
])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'svg_defs'])

interface Ctx {
  basePath: string
  rules: CssRule[]
  footnotes?: WeakMap<Element, Footnote>
  definitions?: WeakMap<Element, string>
}

const CJK_CH = /[\u2e80-\u9fff\uac00-\ud7ff\uf900-\ufaff\uff00-\uffef]/u

/** Source line breaks collapse to a space, which must not appear between ideographs. */
function rewriteRun(run: TextRun, re: RegExp, replace: (...args: any[]) => string) {
  const edits: { start: number; end: number; length: number }[] = []
  const original = run.text
  run.text = original.replace(re, (...args) => {
    const replacement = replace(...args)
    const start = args[args.length - 2] as number
    edits.push({ start, end: start + args[0].length, length: replacement.length })
    return replacement
  })
  if (run.breaks) run.breaks = run.breaks.map((offset) => {
    let delta = 0
    for (const edit of edits) {
      if (offset <= edit.start) break
      if (offset < edit.end) return edit.start + delta + Math.min(offset - edit.start, edit.length)
      delta += edit.length - (edit.end - edit.start)
    }
    return offset + delta
  })
}

function squeezeCjkSpaces(b: Block) {
  let prevTail = ''
  for (const r of b.runs) {
    rewriteRun(r, /(\S) +(?=\S)/gu, (m, a: string, off: number, whole: string) => (CJK_CH.test(a) && CJK_CH.test(whole[off + m.length]) ? a : m))
    if (r.text.startsWith(' ') && prevTail && CJK_CH.test(prevTail) && CJK_CH.test(r.text[1] || '')) rewriteRun(r, /^ /, () => '')
    prevTail = r.text.slice(-1)
  }
}

function convertChapter(doc: Document, ctx: Ctx): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  let pendingIds: string[] = []
  let activeLiterary: Block['literary']
  let activeDefinition: string | undefined
  let nextGroup = 0
  let activeFlow: number | undefined
  let nextFlow = 0

  const begin = (kind: BlockKind, extra: Partial<Block> = {}) => {
    flush()
    cur = { kind, flowId: activeFlow, footnoteDefinition: activeDefinition, runs: [], text: '', start: 0, literary: activeLiterary ? { ...activeLiterary } : undefined, ...extra }
    if (pendingIds.length) {
      cur.ids = pendingIds
      pendingIds = []
    }
    return cur
  }

  function flush() {
    const b = cur as Block | null
    cur = null
    if (!b) return
    if (b.kind !== 'img' && b.kind !== 'hr') {
      // trim whitespace at both ends
      while (b.runs.length && /^\s*$/.test(b.runs[0].text)) b.runs.shift()
      if (b.runs.length) rewriteRun(b.runs[0], /^\s+/, () => '')
      while (b.runs.length && /^\s*$/.test(b.runs[b.runs.length - 1].text)) b.runs.pop()
      if (b.runs.length) {
        const last = b.runs[b.runs.length - 1]
        rewriteRun(last, /\s+$/, () => '')
      }
      if (!b.runs.length && b.kind !== 'pre') {
        if (b.ids) pendingIds.push(...b.ids)
        return
      }
      if (b.kind !== 'pre') squeezeCjkSpaces(b)
      b.text = b.runs.map((r) => r.text).join('')
    }
    blocks.push(b)
  }

  const pushText = (text: string, st: InlineStyle, kind: BlockKind, align?: Align, noIndent?: boolean) => {
    const pre = kind === 'pre'
    let t = pre ? text : text.replace(/[\s\u00a0]+/g, (m) => (m.includes('\u00a0') && m.length === 1 ? '\u00a0' : ' '))
    if (!t) return
    if (!cur) {
      if (!pre && /^\s*$/.test(t)) return
      begin(kind, { align, noIndent })
    }
    const b = cur as Block
    if (!pre && b.runs.length === 0) t = t.replace(/^\s+/, '')
    const prev = b.runs[b.runs.length - 1]
    if (!pre && prev && prev.text.endsWith(' ') && t.startsWith(' ')) t = t.slice(1)
    if (!t) return
    const run: TextRun = { text: t }
    if (st.footnote) run.footnote = st.footnote
    if (st.bold) run.bold = true
    if (st.italic) run.italic = true
    if (st.sup) run.sup = true
    if (st.mono) run.mono = true
    if (st.smallcaps) run.smallcaps = true
    if (
      prev &&
      prev.footnote === run.footnote &&
      !!prev.bold === !!run.bold &&
      !!prev.italic === !!run.italic &&
      !!prev.sup === !!run.sup &&
      !!prev.mono === !!run.mono &&
      !!prev.smallcaps === !!run.smallcaps
    ) {
      prev.text += run.text
    } else b.runs.push(run)
  }

  const imageFrom = (el: Element): string | null => {
    const src =
      el.getAttribute('src') ||
      el.getAttribute('href') ||
      el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      el.getAttribute('xlink:href')
    return src ? resolvePath(ctx.basePath, src) : null
  }

  function walk(...args: Parameters<typeof walkNode>) {
    const previous = activeDefinition
    const previousFlow = activeFlow
    const node = args[0]
    if (node.nodeType === 1) activeDefinition = ctx.definitions?.get(node as Element) ?? previous
    if (node.nodeType === 1 && /^(p|li|h[1-6]|pre|blockquote)$/.test(local(node as Element))) activeFlow = ++nextFlow
    try { walkNode(...args) } finally { activeDefinition = previous; activeFlow = previousFlow }
  }

  function walkNode(
    node: Node,
    st: InlineStyle,
    kind: BlockKind,
    align: Align | undefined,
    noIndent: boolean | undefined,
    listCounter: { n: number; ordered: boolean } | null,
  ) {
    if (node.nodeType === 3) {
      pushText(node.nodeValue || '', st, kind, align, noIndent)
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = local(el)
    if (SKIP_TAGS.has(tag)) return
    const css = styleFor(el, ctx.rules)
    const id = el.getAttribute('id')
    if (id) {
      if (cur) (cur.ids ||= []).push(id)
      else pendingIds.push(id)
    }

    if (tag === 'img' || tag === 'image') {
      const path = imageFrom(el)
      if (path) {
        begin('img', { img: { path, alt: el.getAttribute('alt') || '', footnote: st.footnote }, align: 'center' })
        flush()
      }
      return
    }
    if (tag === 'br') {
      if (cur) {
        pushText('\n', st, kind, align, noIndent)
        const run = (cur as Block).runs.at(-1)
        if (run) (run.breaks ||= []).push(run.text.length)
      }
      return
    }
    if (tag === 'hr') {
      begin('hr')
      flush()
      return
    }

    const nextSt: InlineStyle = { ...st }
    const footnote = ctx.footnotes?.get(el)
    if (footnote) nextSt.footnote = footnote
    if (tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag) === false && css.bold) nextSt.bold = true
    if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn' || tag === 'var' || css.italic) nextSt.italic = true
    if (css.italic === false && tag !== 'i' && tag !== 'em') nextSt.italic = false
    if (tag === 'sup') nextSt.sup = true
    // Legacy EPUBs wrap quoted prose in <tt> for a contrasting typeface. Let the
    // reader's font choice win there, while explicit code keeps its monospace semantics.
    const quotedProse = kind === 'quote' || activeLiterary?.role === 'quote'
    if (tag === 'pre' || tag === 'code' || tag === 'kbd' || tag === 'samp' || (tag === 'tt' && !quotedProse)) nextSt.mono = true
    if (css.smallcaps) nextSt.smallcaps = true

    if (BLOCK_TAGS.has(tag)) {
      flush()
      const inherited = activeLiterary
      const semanticRole = literaryRole(tag, el.getAttribute('epub:type') || el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '', el.getAttribute('role') || '', el.getAttribute('class') || '')
      if (semanticRole) activeLiterary = { role: semanticRole, group: inherited?.group ?? ++nextGroup }
      else if (tag === 'footer' && inherited) activeLiterary = { ...inherited, role: 'attribution' }
      let k: BlockKind = kind
      let counter = listCounter
      let al = css.align ?? align
      if (/^h[1-3]$/.test(tag)) {
        k = tag as BlockKind
        al = css.align ?? 'center'
      } else if (/^h[4-6]$/.test(tag)) {
        k = 'h3'
        al = css.align ?? 'center'
      } else if (tag === 'blockquote') k = 'quote'
      else if (tag === 'pre') k = 'pre'
      else if (tag === 'ul' || tag === 'ol') {
        counter = { n: 0, ordered: tag === 'ol' }
        flush()
      } else if (tag === 'li') {
        k = 'li'
        flush()
      }
      const noInd = css.noIndent ?? noIndent
      flush()
      if (tag === 'li' && counter) {
        counter.n++
        begin('li', { marker: counter.ordered ? `${counter.n}.` : '•', align: al })
      } else if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'figcaption', 'td', 'th'].includes(tag)) {
        begin(k, { align: al, noIndent: noInd })
      }
      for (const c of Array.from(el.childNodes)) walk(c, nextSt, k, al, noInd, counter)
      flush()
      activeLiterary = inherited
      return
    }
    for (const c of Array.from(el.childNodes)) walk(c, nextSt, kind, css.align ?? align, noIndent, listCounter)
  }

  const body = descendants(doc, 'body')[0] || doc.documentElement
  walk(body, {}, 'p', undefined, undefined, null)
  flush()

  // compute offsets & fold id lists
  let off = 0
  for (const b of blocks) {
    b.start = off
    off += b.text.length + 1
  }
  annotateLiteraryBlocks(blocks)
  annotateChapterOpening(blocks)
  return blocks
}

/* ------------------------------ main parser ------------------------------ */

export async function parseEpub(data: Blob | ArrayBuffer): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(data)
  const readText = async (path: string) => {
    const f = zip.file(path) || zip.file(decodeURIComponent(path))
    return f ? f.async('string') : null
  }

  const containerXml = await readText('META-INF/container.xml')
  if (!containerXml) throw new Error(t("Not a valid EPUB: missing container.xml"))
  const container = parseXml(containerXml)
  const rootfile = descendants(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!rootfile) throw new Error(t("Not a valid EPUB: no rootfile"))
  const opfText = await readText(rootfile)
  if (!opfText) throw new Error(t("Not a valid EPUB: OPF missing"))
  const opf = parseXml(opfText)
  const opfPath = rootfile

  const metaText = (name: string) => descendants(opf, name)[0]?.textContent?.trim() || ''
  const title = metaText('title') || 'Untitled'
  const author = descendants(opf, 'creator').map((e) => e.textContent?.trim()).filter(Boolean).join(', ')
  const language = metaText('language') || 'en'

  interface Item { id: string; href: string; path: string; type: string; props: string }
  const manifest = new Map<string, Item>()
  for (const it of descendants(opf, 'item')) {
    const href = it.getAttribute('href') || ''
    manifest.set(it.getAttribute('id') || '', {
      id: it.getAttribute('id') || '',
      href,
      path: resolvePath(opfPath, href),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    })
  }
  const spineEl = descendants(opf, 'spine')[0]
  const spineItems = spineEl
    ? children(spineEl, 'itemref')
        .map((r) => manifest.get(r.getAttribute('idref') || ''))
        .filter((x): x is Item => !!x && /x?html|xml/.test(x.type))
    : []

  // cover
  let coverItem = Array.from(manifest.values()).find((i) => i.props.includes('cover-image'))
  if (!coverItem) {
    const meta = descendants(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')
    if (meta) coverItem = manifest.get(meta.getAttribute('content') || '')
  }
  if (!coverItem) coverItem = Array.from(manifest.values()).find((i) => /image/.test(i.type) && /cover/i.test(i.id + i.href))
  let cover: Blob | undefined
  if (coverItem) {
    const f = zip.file(coverItem.path)
    if (f) cover = new Blob([await f.async('arraybuffer')], { type: coverItem.type || 'image/jpeg' })
  }

  // Cache markup, including note documents outside the spine.
  const documents = new Map<string, Document | null>()
  const markupPaths = new Set(Array.from(manifest.values()).filter(i => /x?html|xml/.test(i.type)).map(i => i.path))
  const readDocument = async (path: string) => {
    if (!markupPaths.has(path)) return null
    if (!documents.has(path)) {
      const source = await readText(path)
      documents.set(path, source ? parseMarkup(source) : null)
    }
    return documents.get(path) ?? null
  }

  // Resolve every spine reference first, including references to an earlier spine document.
  const definitions = new WeakMap<Element, string>()
  const references = new Map<string, WeakMap<Element, Footnote>>()
  for (const item of spineItems) {
    const doc = await readDocument(item.path)
    if (doc) references.set(item.path, await resolveFootnotes(doc, item.path, resolvePath, readDocument, definitions))
  }

  // chapters
  const chapters: Chapter[] = []
  const hrefToChapter = new Map<string, number>()
  const cssCache = new Map<string, CssRule[]>()
  for (const item of spineItems) {
    const doc = await readDocument(item.path)
    if (!doc) continue
    let rules: CssRule[] = []
    for (const l of descendants(doc, 'link')) {
      const href = l.getAttribute('href')
      if (!href || !/stylesheet/i.test(l.getAttribute('rel') || '')) continue
      const p = resolvePath(item.path, href)
      if (!cssCache.has(p)) cssCache.set(p, parseCss((await readText(p)) || ''))
      rules = rules.concat(cssCache.get(p)!)
    }
    for (const s of descendants(doc, 'style')) rules = rules.concat(parseCss(s.textContent || ''))
    const original = convertChapter(doc, { basePath: item.path, rules })
    const footnotes = references.get(item.path)
    const annotated = convertChapter(doc, { basePath: item.path, rules, footnotes, definitions })
    // Adding link metadata must never move saved marks or indexed citation offsets.
    const blocks = original.length === annotated.length && original.every((b, i) => b.text === annotated[i].text && b.start === annotated[i].start) ? annotated : original
    if (!blocks.length) continue
    const last = blocks[blocks.length - 1]
    const idx = chapters.length
    chapters.push({
      index: idx,
      href: item.path,
      title: '',
      blocks,
      textLength: last.start + last.text.length,
    })
    hrefToChapter.set(item.path, idx)
  }
  if (!chapters.length) throw new Error(t("This EPUB has no readable text"))
  // Hide definitions only when an actual, visible reference survived conversion.
  const reachable = new Set(chapters.flatMap(c => c.blocks.filter(b => !b.footnoteDefinition).flatMap(b => [
    ...b.runs.flatMap(r => r.footnote ? [r.footnote.id] : []),
    ...(b.img?.footnote ? [b.img.footnote.id] : []),
  ])))
  for (const c of chapters) for (const b of c.blocks) {
    if (b.footnoteDefinition && !reachable.has(b.footnoteDefinition)) delete b.footnoteDefinition
  }

  // table of contents
  const toc: TocItem[] = []
  const navItem = Array.from(manifest.values()).find((i) => i.props.includes('nav'))
  const ncxItem = (spineEl && manifest.get(spineEl.getAttribute('toc') || '')) || Array.from(manifest.values()).find((i) => i.type.includes('ncx'))
  const addToc = (label: string, href: string, level: number, from: string) => {
    const path = resolvePath(from, href)
    const ch = hrefToChapter.get(path)
    if (ch === undefined) return
    const frag = href.includes('#') ? href.split('#')[1] : ''
    let block: number | undefined
    if (frag) {
      const bi = chapters[ch].blocks.findIndex((b) => b.ids?.includes(frag))
      if (bi > 0) block = bi
    }
    let anchor = frag
    try { anchor = decodeURIComponent(frag) } catch { /* preserve malformed publisher escapes */ }
    toc.push({ href: path + (anchor ? '#' + anchor : ''), title: label.replace(/\s+/g, ' ').trim(), chapter: ch, block, level })
  }
  if (navItem) {
    const t = await readText(navItem.path)
    if (t) {
      const nav = parseMarkup(t)
      const navEl = descendants(nav, 'nav').find((n) => (n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').includes('toc')) || descendants(nav, 'nav')[0]
      const walkList = (ol: Element, level: number) => {
        for (const li of children(ol, 'li')) {
          const a = children(li, 'a')[0] || children(li, 'span')[0]
          if (a?.getAttribute('href')) addToc(a.textContent || '', a.getAttribute('href')!, level, navItem.path)
          for (const sub of children(li, 'ol')) walkList(sub, level + 1)
        }
      }
      const ol = navEl && children(navEl, 'ol')[0]
      if (ol) walkList(ol, 0)
    }
  }
  if (!toc.length && ncxItem) {
    const t = await readText(ncxItem.path)
    if (t) {
      const ncx = parseXml(t)
      const walkPoints = (parent: Element, level: number) => {
        for (const np of children(parent, 'navpoint')) {
          const label = children(np, 'navlabel')[0]?.textContent || ''
          const src = children(np, 'content')[0]?.getAttribute('src')
          if (src) addToc(label, src, level, ncxItem.path)
          walkPoints(np, level + 1)
        }
      }
      const map = descendants(ncx, 'navMap')[0]
      if (map) walkPoints(map, 0)
    }
  }
  if (!toc.length) {
    chapters.forEach((c, i) => {
      const h = c.blocks.find((b) => b.kind.startsWith('h'))
      toc.push({ title: h?.text.replace(/\s+/g, ' ') || `Section ${i + 1}`, chapter: i, level: 0, href: c.href })
    })
  }
  for (const t of toc) {
    const ch = chapters[t.chapter]
    if (!ch.title) ch.title = t.title
  }
  chapters.forEach((c, i) => {
    if (!c.title) c.title = c.blocks.find((b) => b.kind.startsWith('h'))?.text || `Section ${i + 1}`
  })

  return {
    meta: { title, author, language },
    chapters,
    toc,
    cover,
    async getImage(path: string) {
      const f = zip.file(path) || zip.file(decodeURIComponent(path))
      if (!f) return null
      const buf = await f.async('arraybuffer')
      const ext = path.split('.').pop()?.toLowerCase() || ''
      const type = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      return new Blob([buf], { type })
    },
  }
}
