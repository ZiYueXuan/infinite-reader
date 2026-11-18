import { t } from '../i18n'
import { useEffect, useId, useState } from 'react'

export default function MermaidBlock({ source }: { source: string }) {
  const id = 'mermaid-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [result, setResult] = useState<{ source: string; svg: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', suppressErrorRendering: true, maxTextSize: 50_000, maxEdges: 500 })
        const { svg } = await mermaid.render(id, source)
        if (!cancelled) setResult({ source, svg })
      } catch { if (!cancelled) setResult({ source, svg: '' }) }
    })()
    return () => { cancelled = true }
  }, [source, id])
  const current = result?.source === source ? result : null
  // SVG is an image, never active HTML: scripts, links and external subresources cannot execute.
  return <div className="answer-diagram">
    {current?.svg ? <img alt={t("Mermaid diagram")} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(current.svg)} /> : <p className="answer-diagram-status">{current ? t("Diagram could not be rendered. Source is shown below.") : t("Rendering diagram…")}</p>}
    <details open={!current?.svg}><summary>{t("Mermaid source")}</summary><pre><code>{source}</code></pre></details>
  </div>
}
