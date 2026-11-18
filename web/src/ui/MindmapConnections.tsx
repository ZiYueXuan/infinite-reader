import { useEffect, useState, type RefObject } from 'react'

interface Edge { id: string; path: string; branch: number; depth: number }
/** Measure layout coordinates, independent of canvas pan/zoom. The SVG never affects layout. */
export function MindmapConnections({ content, layoutKey }: { content: RefObject<HTMLDivElement | null>; layoutKey: unknown }) {
  const [edges, setEdges] = useState<Edge[]>([])
  // The ancestor content ref is attached after child layout effects run.
  // Measure after the commit so first-open maps also subscribe to layout changes.
  useEffect(() => {
    const tree = content.current
    if (!tree) return
    const measure = () => {
      const bounds = tree.getBoundingClientRect(), scale = bounds.width / tree.offsetWidth
      if (!scale) return
      const nodes = new Map(Array.from(tree.querySelectorAll<HTMLElement>('[data-node-path]')).map(el => [el.dataset.nodePath!, el]))
      const next: Edge[] = []
      for (const [path, child] of nodes) {
        const parent = nodes.get(path.slice(0, path.lastIndexOf('.')))
        if (!parent) continue
        const from = parent.getBoundingClientRect(), to = child.getBoundingClientRect()
        const x1 = (from.right - bounds.left) / scale, y1 = (from.top + from.height / 2 - bounds.top) / scale
        const x2 = (to.left - bounds.left) / scale, y2 = (to.top + to.height / 2 - bounds.top) / scale
        const bend = (x2 - x1) * .5
        next.push({ id: path, branch: Number(path.split('.')[1]) % 6, depth: path.split('.').length - 1,
          path: `M${x1},${y1} C${x1+bend},${y1} ${x2-bend},${y2} ${x2},${y2}` })
      }
      setEdges(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(tree)
    tree.querySelectorAll('.mindmap-node').forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [content, layoutKey])
  return <svg className="mindmap-connections" aria-hidden="true" focusable="false">
    {edges.map(edge => <path key={edge.id} data-edge={edge.id} d={edge.path} fill="none" stroke={`var(--map-branch-${edge.branch})`} strokeWidth={edge.depth === 1 ? 2.4 : 1.6} />)}
  </svg>
}
