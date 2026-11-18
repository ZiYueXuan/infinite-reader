import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useT } from '../i18n'

/** A real Markdown renderer, progressively fed the same note as the story advances. */
export default function LandingMarkdownDemo({ step }: { step: number }) {
  const t = useT()
  const heading = `### ${t('A thought worth keeping')}`
  // CommonMark accepts a lone '-' as an empty list. Keep this unfinished input
  // literal until the next beat adds the space, matching the editor's input rule.
  const source = step === 0 ? `${heading}\n\n\\-` : `${heading}\n\n- ${t('Notice the central idea.')}\n- ${step > 1 ? `**${t('Ask a better question.')}**` : t('Ask a better question.')}${step > 2 ? `\n\n> ${t('Read slowly. Think freely.')}` : ''}`
  return <div className="story-markdown-output" data-markdown-step={step}><Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown><span className="story-note-caret" /></div>
}
