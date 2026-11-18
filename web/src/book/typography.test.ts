import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annotateLiteraryBlocks, literaryRole } from './typography.ts'
import type { Block } from './types.ts'
const make = (texts: string[]): Block[] => texts.map((text, i) => ({ kind: i ? 'p' : 'h1', text, start: texts.slice(0, i).reduce((sum, s) => sum + s.length + 1, 0), runs: [{ text }], ids: [`b${i}`] }))
const prose = '随后进入这一章的正文，讨论历史事件的背景，以及书中人物所处的时代。'.repeat(4)
test('conservative epigraph recognition preserves all source data', () => {
  const b = make(['章首', '愁苦的波斯，在过去的岁月里', '一直是各路强者的舞台。', '他们有勇有谋，', '征服非洲，踏足欧洲。', '——马洛', prose])
  const original = structuredClone(b)
  annotateLiteraryBlocks(b)
  assert.equal(b[1].literary?.role, 'epigraph')
  assert.equal(b[1].literary?.first, true)
  assert.equal(b[5].literary?.role, 'attribution')
  assert.equal(b[5].literary?.last, true)
  assert.equal(b[6].literary, undefined)
  assert.deepEqual(b.map(({ literary: _lit, ...rest }) => rest), original)
})
test('short prose, dialogue, lists and missing attribution stay ordinary', () => {
  for (const texts of [
    ['章首', '短段一', '短段二', '短段三', prose],
    ['章首', '“一句对白。”', '“另一句对白。”', '“继续对白。”', '——马洛', prose],
    ['章首', '1. 条目', '2. 条目', '3. 条目', '——马洛', prose],
    ['章首', '短段一', '短段二', '短段三', '——马洛'],
  ]) { const b = make(texts); annotateLiteraryBlocks(b); assert.ok(b.every((v) => !v.literary)) }
})
test('explicit semantics take priority and recognize a final signature', () => {
  assert.equal(literaryRole('div', 'epigraph', '', ''), 'epigraph')
  assert.equal(literaryRole('section', '', 'doc-epigraph', ''), 'epigraph')
  assert.equal(literaryRole('div', '', '', 'calibre2'), undefined)
  assert.equal(literaryRole('div', '', '', 'poetry'), 'verse')
  assert.equal(literaryRole('blockquote', '', '', ''), 'quote')
  const b = make(['题辞', '短段', '——作者', prose])
  b[1].literary = { role: 'quote', group: 1 }; b[2].literary = { role: 'quote', group: 1 }
  annotateLiteraryBlocks(b)
  assert.equal(b[1].literary.first, true)
  assert.equal(b[2].literary.role, 'attribution')
})
