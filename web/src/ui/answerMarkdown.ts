import type { Element, Root, RootContent } from 'hast'
import { defaultSchema, type Options } from 'rehype-sanitize'

// Preserve only safe HTML and math markers. IDs are scoped below after sanitization.
export const answerSchema: Options = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []).filter(attr => Array.isArray(attr) ? attr[0] !== 'className' : attr !== 'className'), ['className', /^language-./, 'math-inline', 'math-display']],
  },
}

export interface ReaderMarkdownOptions { prefix: string; citations: ReadonlyMap<number, string> }
/** Run after sanitization, before math/highlighting; never interpret references inside code or links. */
export function rehypeReaderMarkdown({ prefix, citations }: ReaderMarkdownOptions) {
  return (tree: Root, file: { value: unknown }) => {
    const ids = new Map<string, string>()
    const scope = (nodes: RootContent[]) => {
      for (const node of nodes) if (node.type === 'element') {
        for (const attr of ['id', 'name']) {
          const old = node.properties[attr]
          if (typeof old === 'string') { const id = prefix + old; ids.set(old, id); node.properties[attr] = id }
        }
        scope(node.children)
      }
    }
    scope(tree.children)
    const source = String(file.value)
    const visit = (nodes: RootContent[], protectedText = false): RootContent[] => nodes.flatMap((node): RootContent[] => {
      if (node.type === 'element') {
        const href = node.properties.href
        if (typeof href === 'string' && href.startsWith('#') && ids.has(href.slice(1))) node.properties.href = '#' + ids.get(href.slice(1))
        const label = node.properties.ariaDescribedBy
        if (Array.isArray(label)) node.properties.ariaDescribedBy = label.map(id => ids.get(String(id)) ?? id)
        node.children = visit(node.children, protectedText || ['a', 'code', 'pre', 'script', 'style', 'textarea', 'svg', 'math'].includes(node.tagName)) as Element['children']
        return [node]
      }
      if (node.type !== 'text' || protectedText || !citations.size) return [node]
      const result: RootContent[] = []
      let end = 0
      // HAST retains source positions, so an explicitly escaped reference stays literal.
      const raw = source.slice(node.position?.start.offset, node.position?.end.offset)
      const original = [...raw.matchAll(/(\\*)\[(\d+)\]/g)]
      let ordinal = 0
      for (const match of node.value.matchAll(/\[(\d+)\]/g)) {
        const n = Number(match[1]), href = citations.get(n)
        const escaped = original[ordinal]?.[2] === match[1] && original[ordinal]![1].length % 2 === 1
        ordinal++
        if (!href || escaped) continue
        if (match.index > end) result.push({ type: 'text', value: node.value.slice(end, match.index) })
        result.push({ type: 'text', value: '\u2060' }, { type: 'element', tagName: 'a', properties: { href, dataBookCitation: n }, children: [{ type: 'text', value: String(n) }] })
        end = match.index + match[0].length
      }
      if (!result.length) return [node]
      if (end < node.value.length) result.push({ type: 'text', value: node.value.slice(end) })
      return result
    })
    tree.children = visit(tree.children)
  }
}

export function markdownNodeText(node: RootContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(markdownNodeText).join('')
  return ''
}
