import { t } from '../i18n/runtime.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LAYOUT, paginate, type Paginated, type LayoutConfig } from './layout.ts'
import { noteLayoutSignature, type Annotation } from './annotations.ts'
import type { ParsedBook } from './types.ts'

// A deterministic text measurer lets these tests exercise the full paginator in Node.
// Browser checks separately cover actual font metrics and rendered appearance.
class MeasuringCanvas {
  getContext() {
    return {
      font: '16px serif',
      measureText(text: string) {
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16)
        return { width: Array.from(text).reduce((sum, ch) => sum + (/\s/.test(ch) ? 0.3 : /[\u2e80-\u9fff]/.test(ch) ? 1 : 0.55) * size, 0) }
      },
    }
  }
}
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: MeasuringCanvas, configurable: true })

const cfg: LayoutConfig = { ...DEFAULT_LAYOUT, pageW: 360, pageH: 330, marginTop: 30, marginBottom: 30, marginInner: 30, marginOuter: 30, fontSize: 16 }
function book(paragraphs: string[][]): ParsedBook {
  return {
    meta: { title: 'Reading notes', author: '', language: 'zh' }, toc: [],
    getImage: async () => null,
    chapters: paragraphs.map((texts, index) => {
      let start = 0
      const blocks = texts.map((text) => {
        const block = { kind: 'p' as const, text, start, runs: [{ text }] }
        start += text.length + 1
        return block
      })
      return { index, href: `chapter-${index}`, title: `Chapter ${index}`, blocks, textLength: start - 1 }
    }),
  }
}
function note(id: string, start: number, end: number, text: string, chapter = 0, createdAt = 1): Annotation {
  return { id, bookId: 'book', locator: { chapter, start, end }, quote: '', kind: 'highlight', color: 'blue', note: { text, x: 12, y: -3, rot: 0.4 }, createdAt, updatedAt: 1 }
}
const sourceWords = (p: Paginated) => p.pages.flatMap((page) => page.lines.flatMap((line) => line.words.map(({ text, s, e }) => ({ text, s, e }))))
const fragments = (p: Paginated) => p.pages.flatMap((page) => (page.notes ?? []).map((n) => ({ ...n, page: page.index })))

test('rendered note signatures ignore sync timestamps, legacy positions and collection order', async () => {
  const notes = [note('a', 0, 2, '想法'), note('b', 2, 4, '另一个想法')]
  const pag = await paginate(book([['这是用于比较的正文。']]), cfg, undefined, notes)
  const synced = structuredClone(notes).reverse()
  for (const a of synced) { a.updatedAt++; a.note!.x++; a.note!.rot++ }
  synced[0].note!.tags = []
  assert.equal(pag.noteSignature, noteLayoutSignature(synced))
})

test('text, tags, colour and other notes invalidate the rendered snapshot, while reverted edits do not', async () => {
  const original = note('a', 0, 2, '想法')
  const pag = await paginate(book([['这是用于比较的正文。']]), cfg, undefined, [original])
  for (const edit of [
    (a: Annotation) => { a.note!.text += '修改' },
    (a: Annotation) => { a.note!.tags = ['标签'] },
    (a: Annotation) => { a.note!.textColor = 'pink' },
  ]) {
    const draft = structuredClone(original)
    edit(draft)
    assert.notEqual(pag.noteSignature, noteLayoutSignature([draft]))
    Object.assign(draft, structuredClone(original), { updatedAt: 200 })
    assert.equal(pag.noteSignature, noteLayoutSignature([draft]))
  }
  assert.notEqual(pag.noteSignature, noteLayoutSignature([]))
  assert.notEqual(pag.noteSignature, noteLayoutSignature([original, note('b', 2, 4, '另一条修改')]))
  assert.equal(pag.noteSignature, noteLayoutSignature([{ ...original, color: 'pink' }]), 'source colours do not invalidate note layout')
})

test('note fragments use their own text colour across pages, independently of source marks', async () => {
  const a = note('coloured', 0, 2, '独立文字颜色'.repeat(200))
  a.color = 'yellow'
  a.note!.textColor = 'blue'
  const pag = await paginate(book([['这是正文内容。']]), cfg, undefined, [a])
  assert.ok(fragments(pag).length > 1)
  assert.ok(fragments(pag).every(n => n.textColor === 'blue'))
  const recoloured = await paginate(book([['这是正文内容。']]), cfg, undefined, [{ ...a, color: 'pink' }])
  assert.deepEqual(recoloured.pages, pag.pages)
  delete a.note!.textColor
  const legacy = await paginate(book([['这是正文内容。']]), cfg, undefined, [a])
  assert.ok(fragments(legacy).every(n => n.textColor === 'default'))
})

test('an inline note opens space directly after the selected visual line without changing original text or offsets', async () => {
  const source = book([['天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏'.repeat(5)]])
  const original = structuredClone(source.chapters)
  const plain = await paginate(source, cfg)
  const selectedLine = plain.pages[2].lines[1]
  const end = selectedLine.words.at(-1)!.e
  const marked = await paginate(source, cfg, undefined, [note('thought', end - 2, end, '这里改变了叙述视角。')])
  assert.deepEqual(source.chapters, original)
  assert.deepEqual(sourceWords(marked), sourceWords(plain))
  const fragment = fragments(marked)[0]
  const page = marked.pages[fragment.page]
  const before = page.lines.find((line) => line.words.some((w) => w.e === end))!
  assert.ok(before)
  assert.ok(before.y + before.h <= fragment.y)
  const next = page.lines.find((line) => line.words.some((w) => w.s >= end))
  assert.ok(next, 'the remainder of this paragraph should follow the note on this page')
  assert.ok(next.y >= fragment.y + fragment.h)
  assert.ok(fragment.lines.every((line) => line.words.every((w) => w.s === -1 && w.e === -1)))
})

test('notes on the same line have deterministic source/creation/id order and cross-paragraph selections appear only at their end', async () => {
  const source = book([['这是第一段正文。', '这是第二段正文。', '这是第三段正文。']])
  const second = source.chapters[0].blocks[1]
  const anns = [note('b', 1, 3, '乙', 0, 2), note('a', 1, 3, '甲'), note('cross', 2, second.start + 3, '跨段')]
  const result = await paginate(source, cfg, undefined, anns)
  assert.deepEqual(fragments(result).map((n) => n.id), ['a', 'b', 'cross'])
  assert.equal(fragments(result).filter((n) => n.id === 'cross').length, 1)
  const cross = fragments(result).find((n) => n.id === 'cross')!
  assert.ok(result.pages[cross.page].lines.some((line) => line.words.some((w) => w.s >= second.start) && line.y < cross.y))
})

test('long notes split across pages without dropping text, overflowing, or covering source lines', async () => {
  const source = book([['正文在这里开始。随后继续阅读这一段。']])
  const text = '山川异域风月同天'.repeat(240)
  const result = await paginate(source, cfg, undefined, [note('long', 0, 2, text)])
  const parts = fragments(result)
  assert.ok(parts.length > 3)
  assert.equal(parts.flatMap((n) => n.lines.flatMap((line) => line.words.map((w) => w.text))).join(''), text)
  const contentH = cfg.pageH - cfg.marginTop - cfg.marginBottom
  const contentW = cfg.pageW - cfg.marginInner - cfg.marginOuter
  for (const [index, part] of parts.entries()) {
    assert.equal(part.continued, index > 0)
    assert.equal(part.continues, index < parts.length - 1)
    assert.ok(part.y >= 0 && part.y + part.h <= contentH + 0.01)
    assert.ok(part.x >= 0 && part.x + part.w <= contentW)
    for (const line of part.lines) {
      assert.ok(line.y + line.h <= part.h)
      for (const word of line.words) assert.ok(word.x >= 0 && word.x + word.w <= part.w + 0.01)
    }
    for (const line of result.pages[part.page].lines) {
      assert.ok(line.y + line.h <= part.y || line.y >= part.y + part.h)
    }
  }
})

test('chapter-final note continuations survive trimming and citation lookup always returns the page with original words', async () => {
  const source = book([['First chapter ends here.'], ['第二章仍然从自己的正文开始。']])
  const end = source.chapters[0].textLength
  const result = await paginate(source, cfg, undefined, [note('tail', 0, end, '很长的章末笔记'.repeat(200))])
  assert.ok(result.pages.some((p) => p.chapter === 0 && !p.lines.length && !!p.notes?.length))
  assert.equal(result.pageForOffset(0, end), 2, 'end-of-chapter links must not jump to a pure note page')
  assert.equal(result.pageForOffset(1, 0), result.chapterFirstPage[1])
  for (const page of result.pages) for (const line of page.lines) for (const word of line.words) {
    if (word.s >= 0) assert.equal(result.pageForOffset(page.chapter, word.s), page.index)
  }
  const oneChapter = book([['最后一段正文。']])
  const tail = await paginate(oneChapter, cfg, undefined, [note('last', 0, oneChapter.chapters[0].textLength, '末页笔记'.repeat(150))])
  const last = tail.pages.filter((p) => !p.special).at(-1)!
  assert.ok(last.notes?.some((n) => !n.continues))
})

test('legacy note text and tags survive layout; absent or invalid notes leave the original pagination untouched', async () => {
  const source = book([['兼容原有批注和标签，并且正文偏移保持不变。']])
  const existing = note('legacy', 0, 3, 'Old note\n第二段笔记')
  existing.note!.tags = ['历史', 'Reading']
  const result = await paginate(source, cfg, undefined, [existing])
  const words = fragments(result).flatMap((n) => n.lines.flatMap((line) => line.words.map((w) => w.text))).join('')
  assert.ok(words.includes('Oldnote'))
  assert.ok(words.includes('第二段笔记'))
  assert.ok(words.includes('#历史') && words.includes('#Reading'))
  assert.deepEqual(existing.note, { text: 'Old note\n第二段笔记', tags: ['历史', 'Reading'], x: 12, y: -3, rot: 0.4 })
  const plain = await paginate(source, cfg)
  const removed = await paginate(source, cfg, undefined, [])
  assert.deepEqual(removed.pages, plain.pages)
  const bad = await paginate(source, cfg, undefined, [note('outside', 0, 9999, 'bad'), note('chapter', 0, 2, 'bad', 5)])
  assert.deepEqual(bad.pages, plain.pages)
})

test('independent note fonts apply to every continuation and tag without changing source fonts or offsets', async () => {
  const source = book([['这是原文。'.repeat(16)]])
  const a = note('font-test', 0, 3, '手写笔记和 English text。'.repeat(40))
  a.note!.font = 'caveat'
  a.note!.tags = ['中文标签', 'English']
  const body = structuredClone(source.chapters)
  const pag = await paginate(source, cfg, undefined, [a])
  const noteWords = fragments(pag).flatMap(n => n.lines.flatMap(l => l.words))
  assert.ok(fragments(pag).length > 1)
  assert.ok(noteWords.every(w => w.font.includes('Caveat Variable') && w.font.includes('LXGW WenKai')))
  assert.ok(pag.pages.flatMap(p => p.lines.flatMap(l => l.words)).every(w => !w.font.includes('Caveat')))
  const previous = noteLayoutSignature([a])
  a.note!.font = 'ma-shan-zheng'
  assert.notEqual(noteLayoutSignature([a]), previous)
  const changed = await paginate(source, cfg, undefined, [a])
  assert.ok(fragments(changed).flatMap(n => n.lines.flatMap(l => l.words)).every(w => w.font.includes('Ma Shan Zheng')))
  assert.deepEqual(sourceWords(pag), sourceWords(changed))
  assert.deepEqual(source.chapters, body)
})


test('tag identities survive wrapping and note continuation without making note body hashtags clickable', async () => {
  const source = book([['这是带标签的原文。'.repeat(12)]])
  const a = note('tag-hit', 0, 3, '#quote is ordinary note text. '.repeat(60))
  a.note!.tags = ['quote', '中文标签换行验证测试', 'two words', 'another-long-tag']
  const pag = await paginate(source, { ...cfg, pageW: 220 }, undefined, [a])
  const words = fragments(pag).flatMap(n => n.lines.flatMap(l => l.words))
  assert.ok(fragments(pag).length > 1)
  assert.ok(words.some(w => w.text.includes('quote') && !w.noteTag))
  for (const tag of a.note!.tags) {
    const tagged = words.filter(w => w.noteTag === tag)
    assert.ok(tagged.length > 0, tag)
    assert.equal(tagged.map(w => w.text).join('').replace(/\s/g, ''), `#${tag}`.replace(/\s/g, ''))
    assert.ok(tagged.every(w => w.s === -1 && w.e === -1))
  }
  assert.ok(pag.pages.flatMap(p => p.lines.flatMap(l => l.words)).every(w => !w.noteTag))
})


test('tag-only notes omit placeholder and body rows, including whitespace-only text', async () => {
  const source = book([['只有标签的笔记也应该紧凑地排版。']])
  const a = note('tag-only', 0, 3, '')
  a.note!.tags = ['quote']
  const tagged = fragments(await paginate(source, cfg, undefined, [a]))
  assert.equal(tagged.length, 1)
  assert.equal(tagged[0].lines.length, 1)
  assert.equal(tagged[0].lines[0].words.map(w => w.text).join(''), '#quote')
  assert.ok(tagged[0].lines[0].words.every(w => w.noteTag === 'quote'))
  a.note!.text = ' \n\t '
  assert.deepEqual(fragments(await paginate(source, cfg, undefined, [a])), tagged)
  a.note!.tags = []
  const empty = fragments(await paginate(source, cfg, undefined, [a]))
  assert.equal(empty[0].lines.flatMap(l => l.words.map(w => w.text + (w.space ? ' ' : ''))).join('').trim(), t('写下你的想法…'))
})

test('Markdown notes paginate styled ink without changing chapter offsets or stored source', async () => {
  const source = book([['原文保持不变。'.repeat(20)]])
  const text = '# 标题\n\n**加粗**、*倾斜*、~~删除~~、`code`、[链接](https://example.com)\n\n1. 第一项\n2. 第二项\n   - 子项\n\n> 引文\n\n---\n\n```js\n  const x = 1\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 中文 | **内容** |'
  const a = note('markdown', 0, 2, text)
  a.note!.tags = ['quote']
  const original = JSON.stringify(a)
  const plain = await paginate(source, cfg)
  const result = await paginate(source, cfg, undefined, [a])
  assert.deepEqual(sourceWords(result), sourceWords(plain))
  assert.equal(JSON.stringify(a), original)
  const lines = fragments(result).flatMap(n => n.lines)
  const words = lines.flatMap(l => l.words)
  assert.ok(words.some(w => w.font.startsWith('660 ') && w.text === '加'))
  assert.ok(words.some(w => w.font.startsWith('italic ') && w.text === '倾'))
  assert.ok(words.some(w => w.noteStrike))
  assert.ok(words.some(w => w.noteCode && w.font.includes('monospace')))
  assert.ok(words.some(w => w.noteLink === 'https://example.com'))
  assert.ok(words.some(w => w.noteTag === 'quote'))
  assert.ok(words.every(w => w.s === -1 && w.e === -1))
  assert.ok(lines.some(l => l.noteDecoration?.quoteX != null))
  assert.ok(lines.some(l => l.noteDecoration?.rule))
  assert.ok(lines.some(l => l.noteDecoration?.cells?.length === 2))
  assert.ok(words.some(w => w.text === '1.') && words.some(w => w.text === '2.'))
})

test('long Markdown cells and code wrap across small pages without dropping content or overflow', async () => {
  const source = book([['测试内容。']])
  const long = '正文'.repeat(100)
  const a = note('tables', 0, 2, `| 列一 | 列二 |\n| --- | --- |\n| **${long}** | ${long} |\n\n\`\`\`\n    ${'VeryLongCode'.repeat(50)}\n\`\`\``)
  for (const pageW of [220, 360]) {
    const parts = fragments(await paginate(source, { ...cfg, pageW }, undefined, [a]))
    const words = parts.flatMap(n => n.lines.flatMap(l => l.words))
    assert.equal(words.map(w => w.text).join('').match(/正/g)?.length, 200)
    assert.equal(words.map(w => w.text).join('').match(/文/g)?.length, 200)
    assert.equal(words.map(w => w.text).join('').match(/VeryLongCode/g)?.length, 50)
    assert.ok(parts.length > 3)
    for (const part of parts) for (const line of part.lines) for (const word of line.words) {
      assert.ok(word.x >= 0 && word.x + word.w <= part.w + 0.01, `${word.text}: ${word.x + word.w} > ${part.w}`)
      assert.ok(line.y + line.h <= part.h)
    }
  }
})
