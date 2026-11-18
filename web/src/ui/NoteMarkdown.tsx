import Markdown from 'react-markdown'
import type { Root, Element, Nodes } from 'hast'
import remarkGfm from 'remark-gfm'
import { noteLink } from '../book/noteMarkdown'
import { t } from '../i18n'
import './note-markdown.css'

function sourcePositionsPlugin() {
  return (tree: Root) => {
    const visit = (node: Nodes) => {
      if (node.type === 'element' && node.position) {
        node.properties.dataNoteSourceStart = node.position.start.offset
        node.properties.dataNoteSourceEnd = node.position.end.offset
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}
const sourceAttributes = (node?: Element) => ({
  'data-note-source-start': node?.properties.dataNoteSourceStart as number | undefined,
  'data-note-source-end': node?.properties.dataNoteSourceEnd as number | undefined,
})

/** No raw HTML or remote images: the same safe Markdown supported by book-page ink. */
export function NoteMarkdown({ text, sourcePositions = false }: { text: string; sourcePositions?: boolean }) {
  return <div className="note-markdown"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={sourcePositions ? [sourcePositionsPlugin] : []} urlTransform={url => noteLink(url) ?? ''} components={{
    a: ({ href, children, node }) => href ? <a {...sourceAttributes(node)} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ src, alt }) => src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || src}</a> : <span>{alt}</span>,
    table: ({ children, node }) => <div className="note-markdown-table" role="region" aria-label={t("Table (scroll horizontally)")} tabIndex={0}><table {...sourceAttributes(node)}>{children}</table></div>,
  }}>{text}</Markdown></div>
}
