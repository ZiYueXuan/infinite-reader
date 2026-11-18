import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNoteMarkdown, noteLink } from './noteMarkdown.ts'

test('CommonMark and GFM structures preserve text and nested emphasis', () => {
  const source = '# 标题\n\n**粗体 *斜体*** 与 ~~删除~~、`code`\n\n3. 第一项\n4. 第二项\n   - 子项\n\n- [x] 完成\n- [ ] 待办\n\n> 引用\n\n---\n\n```js\n  const x = 1\n```'
  const blocks = parseNoteMarkdown(source)
  assert.equal(blocks[0].heading, 1)
  assert.ok(blocks[1].runs.some(r => r.text === '斜体' && r.bold && r.italic))
  assert.ok(blocks[1].runs.some(r => r.strike && r.text === '删除'))
  assert.ok(blocks[1].runs.some(r => r.code && r.mono))
  assert.deepEqual(blocks.filter(b => b.marker).map(b => b.marker), ['3.', '4.', '•', '☑', '☐'])
  assert.ok(blocks.some(b => b.indent === 2))
  assert.ok(blocks.some(b => b.quote === 1))
  assert.ok(blocks.some(b => b.kind === 'rule'))
  assert.equal(blocks.at(-1)?.runs[0].text, '  const x = 1')
})

test('tables retain rich cells and alignment; hard and soft line breaks survive', () => {
  const blocks = parseNoteMarkdown('| Name | Value |\n| :--- | ---: |\n| **中文** | `42` |\n\nfirst\nsecond  \nthird')
  assert.equal(blocks[0].tableHeader, true)
  assert.deepEqual(blocks[1].align, ['left', 'right'])
  assert.equal(blocks[1].cells?.[0][0].bold, true)
  assert.equal(blocks[1].cells?.[1][0].code, true)
  assert.equal(blocks[2].runs.map(r => r.text).join(''), 'first\nsecond\nthird')
})

test('safe reference links resolve; HTML, images and unsafe URLs cannot execute', () => {
  const blocks = parseNoteMarkdown('[read][book] [bad](javascript:alert) ![diagram](https://example.com/image.png)\n\n[book]: https://example.com\n\n<script>alert(1)</script>')
  assert.equal(blocks[0].runs.find(r => r.text === 'read')?.href, 'https://example.com')
  assert.equal(blocks[0].runs.find(r => r.text === 'bad')?.href, undefined)
  assert.equal(blocks[0].runs.find(r => r.text === 'diagram')?.href, 'https://example.com/image.png')
  assert.equal(blocks.at(-1)?.runs[0].text, '<script>alert(1)</script>')
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '/relative', '#fragment', 'file:///tmp/a']) assert.equal(noteLink(url), undefined)
  assert.equal(noteLink('mailto:reader@example.com'), 'mailto:reader@example.com')
})
