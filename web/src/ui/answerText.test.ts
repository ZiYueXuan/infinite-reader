import assert from 'node:assert/strict'
import test from 'node:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import type { Element, Root } from 'hast'
import { answerSchema, markdownNodeText, rehypeReaderMarkdown } from './answerMarkdown.ts'

const sources = new Map([[2, '/book/test#passage=1:40:220'], [5, '/book/test#passage=1:900:1200']])
function parse(text: string, prefix = 'test-') {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkCjkFriendly).use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
    .use(rehypeRaw).use(rehypeSanitize, answerSchema).use(rehypeReaderMarkdown, { prefix, citations: sources }).use(rehypeKatex, { trust: false, strict: false }).use(rehypeHighlight)
  return processor.runSync(processor.parse(text), { value: text }) as Root
}
function elements(tree: Root | Element): Element[] {
  return tree.children.flatMap(node => node.type === 'element' ? [node, ...elements(node)] : [])
}
const refs = (tree: Root) => elements(tree).filter(n => n.properties.dataBookCitation).map(n => n.properties.dataBookCitation)
const textOf = (tree: Root) => tree.children.map(markdownNodeText).join('')

test('renders emphasis next to Chinese text and quotation marks', () => {
  for (const [source, expected] of [
    ['也可以看出**“联队”是核心战术单位**（约相当于团）。', '“联队”是核心战术单位'],
    ['这里的**“联队”**是核心单位。', '“联队”'],
    ['阅读**《抗日战争》**之后。', '《抗日战争》'],
  ]) {
    const tree = parse(source)
    assert.deepEqual(elements(tree).filter(n => n.tagName === 'strong').map(markdownNodeText), [expected])
    assert.equal(textOf(tree), source.replaceAll('**', ''))
  }
})

test('CJK emphasis preserves nested formatting, citations and source escapes', () => {
  const tree = parse('也可以看出**“联队”是*核心*单位[2]**。随后**“结论”[5]**。')
  assert.equal(elements(tree).filter(n => n.tagName === 'strong').length, 2)
  assert.equal(elements(tree).filter(n => n.tagName === 'em').length, 1)
  assert.deepEqual(refs(tree), [2, 5])
  const literal = '也可以看出**“联队”是核心战术单位**'
  for (const source of ['`' + literal + '`', '```text\n' + literal + '\n```', '    ' + literal, literal.replaceAll('*', '\\*')]) {
    const parsed = parse(source)
    assert.ok(textOf(parsed).includes(literal))
    assert.equal(elements(parsed).filter(n => n.tagName === 'strong').length, 0)
  }
  assert.deepEqual(refs(parse('中文**“引用”\\[2]**')), [])
  assert.equal(elements(parse('English**“quoted”**text')).filter(n => n.tagName === 'strong').length, 0)
})

test('CJK emphasis tolerates every streamed prefix and settles on completion', () => {
  const source = '也可以看出**“联队”是核心战术单位[2]**（约相当于团）。'
  for (let end = 0; end <= source.length; end++) assert.doesNotThrow(() => parse(source.slice(0, end)))
  assert.equal(elements(parse(source)).filter(n => n.tagName === 'strong').length, 1)
  assert.deepEqual(refs(parse(source)), [2])
})

test('renders CommonMark headings, nesting, emphasis, quotes, rules, escapes and code', () => {
  const text = '# 标题\n\nSetext\n---\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n**粗体与 *斜体*** ~~删除~~ \\*literal\\* &amp;\n\n> 引用\n>\n> - 嵌套引用列表\n\n3. First\n   - Nested\n4. Second\n\n---\n\n    indented code\n\n`inline`\n\n```js\nconst x = 1;\n```'
  const tree = parse(text), nodes = elements(tree), tags = nodes.map(n => n.tagName)
  for (const tag of ['h1','h2','h3','h4','h5','h6','strong','em','del','blockquote','ul','ol','li','hr','pre','code']) assert.ok(tags.includes(tag), tag)
  assert.ok(textOf(tree).includes('*literal* &'))
  assert.equal(nodes.find(n => n.tagName === 'ol')?.properties.start, 3)
  assert.ok(nodes.some(n => n.properties.className?.toString().includes('hljs-keyword')))
})

test('renders GFM tables, alignment, tasks, autolinks and reference links', () => {
  const tree = parse('| 层级 | 成本 |\n| :--- | ---: |\n| 芯片 | **40%** [2] |\n\n- [x] Done\n- [ ] Open\n\nhttps://example.com\n\n[manual][docs]\n\n[docs]: https://example.com/docs "Docs"')
  const nodes = elements(tree)
  assert.equal(nodes.filter(n => n.tagName === 'table').length, 1)
  assert.equal(nodes.filter(n => n.tagName === 'th')[1].properties.align, 'right')
  assert.deepEqual(nodes.filter(n => n.tagName === 'input').map(n => [n.properties.checked ?? false, n.properties.disabled]), [[true,true],[false,true]])
  assert.ok(nodes.some(n => n.tagName === 'a' && n.properties.href === 'https://example.com/docs'))
  assert.deepEqual(refs(tree), [2])
})

test('preserves adjacent book citations and nested formatting without hijacking links/code/escapes', () => {
  const tree = parse('书名[2][5] **结论[2]** *补充[5]*；[2](https://example.com)\n\n`[2]` \\[5] [1940] [missing]\n\n<code>[2]</code>\n\n```text\n[5]\n```')
  assert.deepEqual(refs(tree), [2,5,2,5])
  assert.ok(elements(tree).some(n => n.tagName === 'a' && n.properties.href === '/book/test#passage=1:900:1200'))
  assert.ok(textOf(tree).includes('[1940]'))
})

test('scopes footnotes and safe HTML anchors per message, separate from book citations', () => {
  const md = 'Text[^note] [2]\n\n[^note]: Footnote **body**.\n\n<a href="#detail">Go</a><details id="detail"><summary>More</summary>Content</details>'
  const a = elements(parse(md, 'first-')), b = elements(parse(md, 'second-'))
  for (const nodes of [a,b]) {
    const ids = new Set(nodes.map(n => n.properties.id).filter(Boolean))
    for (const link of nodes.filter(n => typeof n.properties.href === 'string' && n.properties.href.startsWith('#'))) assert.ok(ids.has(String(link.properties.href).slice(1)))
  }
  assert.ok(a.filter(n => n.properties.id).every(n => !b.some(other => other.properties.id === n.properties.id)))
  assert.deepEqual(refs(parse(md)), [2])
})

test('renders inline/display math and leaves unknown code languages readable', () => {
  const tree = parse('$x^2$\n\n$$\n\\frac{a}{b}\n$$\n\n```unknown-language\n<hello> [2]\n```')
  const nodes = elements(tree)
  assert.ok(nodes.some(n => n.properties.className?.toString().includes('katex-display')))
  assert.ok(nodes.some(n => n.tagName === 'math'))
  assert.ok(textOf(tree).includes('<hello> [2]'))
  assert.deepEqual(refs(tree), [])
})

test('sanitizes active HTML, unsafe protocols, styles and forged citation attributes', () => {
  const tree = parse('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe><a href="javascript:alert(1)" data-book-citation="2">bad</a><span style="position:fixed" id="location">safe</span>\n\n[bad](javascript:alert%281%29)')
  const nodes = elements(tree)
  assert.ok(!nodes.some(n => ['script','iframe'].includes(n.tagName)))
  for (const n of nodes) for (const [key,value] of Object.entries(n.properties)) {
    assert.ok(!/^on/i.test(key)); assert.notEqual(key, 'style'); assert.notEqual(key, 'dataBookCitation'); assert.ok(!String(value).startsWith('javascript:'))
  }
  assert.ok(nodes.some(n => n.properties.id === 'test-location'))
})

test('all streamed prefixes render safely, including incomplete tables, links, formulas and fences', () => {
  const md = '# 标题\n\n| A | B |\n|---|---|\n| **value** | [2] |\n\n[link](https://example.com)\n\n$x^2$\n\n```js\nconst value = "[5]";\n```'
  for (let end = 0; end <= md.length; end++) assert.doesNotThrow(() => parse(md.slice(0,end)))
  assert.deepEqual(refs(parse('正在输出[2')), [])
  assert.deepEqual(refs(parse('正在输出[2]')), [2])
})
