import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocale, useT } from '../i18n'
import type { BookScene } from './landingBookScene'
import { Icon } from './icons'
import { STORY_CHAPTERS as chapters, STORY_COUNT, bookView, chapterStop, chapterWeight, smooth, storyFrame } from './landingStory'
import bookCoverUrl from './landing-book-cover.webp'
import './landing-experience.css'

const MarkdownDemo = lazy(() => import('./LandingMarkdownDemo'))
const STATIC_STORY_QUERY = '(prefers-reduced-motion: reduce), (max-height: 600px), (max-width: 760px) and (max-height: 700px)'

export function LandingExperience({ sample }: { sample: string }) {
  const t = useT(), locale = useLocale()
  const section = useRef<HTMLElement>(null), host = useRef<HTMLDivElement>(null)
  const angleLabel = useRef<HTMLElement>(null)
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'undefined' || matchMedia(STATIC_STORY_QUERY).matches)
  const [beat, setBeat] = useState(0)
  const [failed, setFailed] = useState(false), [ready, setReady] = useState(false), [active, setActive] = useState(0)
  const still = reduced || failed
  useEffect(() => {
    const media = matchMedia(STATIC_STORY_QUERY)
    const change = () => setReduced(media.matches)
    media.addEventListener('change', change); return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    const root = section.current!, mount = host.current!, scroller = root.closest<HTMLElement>('.landing')!
    if (still) return
    let scene: BookScene | undefined, cancelled = false, started = false, visible = false, frame = 0, lastTime = 0, current = 0, target = 0, phase = -1, lastBeat = -1
    const measure = () => {
      const bounds = root.getBoundingClientRect(), top = scroller.getBoundingClientRect().top
      target = Math.max(0, Math.min(1, (top - bounds.top) / Math.max(1, root.offsetHeight - scroller.clientHeight)))
    }
    const paint = (frameTime: number) => {
      frame = 0
      if (!visible || document.hidden || cancelled) return
      const delta = Math.min(64, frameTime - lastTime || 16); lastTime = frameTime
      current += (target - current) * (1 - Math.exp(-delta / 65))
      if (Math.abs(target - current) < .0002) current = target
      const { time, index, local } = storyFrame(current)
      for (const [i, chapter] of chapters.entries()) root.style.setProperty(`--${chapter.id}`, String(chapterWeight(i, time)))
      root.style.setProperty('--note', String(smooth(3.88, 4.18, time) * (1 - smooth(5.86, 6.12, time))))
      root.style.setProperty('--map', String(chapterWeight(7, time)))
      root.style.setProperty('--mark', String(smooth(3.05, 3.7, time)))
      root.style.setProperty('--theme-warmth', String(chapterWeight(2, time) * smooth(2.05, 2.4, time)))
      const view = bookView(time)
      root.style.setProperty('--tilt-demo', String(view.fraction))
      if (angleLabel.current) angleLabel.current.textContent = `${view.degrees}°`
      for (let i = 0; i < 3; i++) root.style.setProperty(`--branch-${i}`, String(smooth(7.08 + i * .17, 7.35 + i * .17, time)))
      root.style.setProperty('--story-progress', String(current)); root.dataset.progress = current.toFixed(4)
      const nextBeat = Math.min(3, Math.floor(local * 4))
      if (lastBeat !== nextBeat) { lastBeat = nextBeat; setBeat(nextBeat) }
      if (phase !== index) { phase = index; setActive(index) }
      scene?.update(current)
      if (current !== target) frame = requestAnimationFrame(paint)
    }
    const schedule = () => { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(paint) }
    const scroll = () => { measure(); schedule() }
    const contextLost = (event: Event) => { event.preventDefault(); if (!cancelled) setFailed(true) }
    const start = async () => {
      if (started) return
      started = true
      setReady(false)
      try {
        const [module] = await Promise.all([import('./landingBookScene'), document.fonts.ready])
        if (cancelled) return
        const coverImage = new Image()
        coverImage.src = bookCoverUrl
        await Promise.all([module.loadBookFonts(locale === 'zh-CN'), coverImage.decode()])
        if (cancelled) return
        scene = module.createBookScene(mount, locale === 'zh-CN', coverImage)
        mount.querySelector('canvas')?.addEventListener('webglcontextlost', contextLost)
        measure(); current = target; scene.update(current); setReady(true); schedule()
      } catch { if (!cancelled) setFailed(true) }
    }
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting
      if (visible) { measure(); void start(); schedule() } else { cancelAnimationFrame(frame); frame = 0 }
    // Keep the poster in view during the initial hero load. Compile the WebGL
    // scene when the visitor approaches the showcase, not when its edge first appears.
    }, { root: scroller, rootMargin: '0px 0px -65% 0px' })
    observer.observe(root)
    const resize = new ResizeObserver(() => { scene?.resize(); scroll() }); resize.observe(mount)
    scroller.addEventListener('scroll', scroll, { passive: true })
    document.addEventListener('visibilitychange', scroll)
    measure()
    return () => {
      cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect()
      scroller.removeEventListener('scroll', scroll); document.removeEventListener('visibilitychange', scroll)
      mount.querySelector('canvas')?.removeEventListener('webglcontextlost', contextLost)
      scene?.dispose()
    }
  }, [locale, still])
  const go = (index: number) => {
    const root = section.current!, scroller = root.closest<HTMLElement>('.landing')!
    const top = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    scroller.scrollTo({ top: top + chapterStop(index) * (root.offsetHeight - scroller.clientHeight), behavior: reduced ? 'instant' : 'smooth' })
  }
  return <section id="experience" className="book-story" ref={section} data-static={still || undefined} data-ready={ready || undefined} data-phase={active} aria-label={t('Explore the reading experience')}>
    <div className="book-stage">
      <div className="book-stage-top"><span><i />{t('Every book is a beginning.')}</span><a href="#possibilities">{t('Skip the animation')}<span aria-hidden="true">↘</span></a></div>
      <div className="book-scene" ref={host} aria-hidden="true" />
      {(!ready || still) && <div className="book-poster" aria-hidden="true"><img src={bookCoverUrl} width="1024" height="1536" alt="" /></div>}
      <div className="book-story-copy">
        {chapters.map((chapter, i) => <article key={chapter.label} data-active={active === i || still || undefined} aria-hidden={!still && active !== i}>
          <p className="book-chapter-number">{String(i + 1).padStart(2, '0')}<span />{t(chapter.label)}</p>
          <h2>{locale === 'zh-CN' ? t(chapter.title).split('，').map((line, index, lines) => <span className="story-title-line" key={index}>{line}{index < lines.length - 1 ? '，' : ''}</span>) : t(chapter.title)}</h2><p className="book-chapter-description">{t(chapter.text)}</p>
        </article>)}
      </div>
      <div className="story-angle story-demo" aria-hidden="true">
        <span className="story-demo-label">{t('Viewing angle')}</span>
        <div className="story-angle-line"><span>{t('Top-down')}</span><div><i /></div><span>{t('Oblique')}</span></div>
        <strong ref={angleLabel}>{bookView(0).degrees}°</strong><small>{t('See the spine and page edges.')}</small>
      </div>
      <div className="story-appearance story-demo" data-style={active === 2 ? beat : 0} aria-hidden="true">
        <span className="story-demo-label">{t('Fonts & themes')}</span><p>{t('Read slowly. Think freely.')}</p>
        <div className="story-theme-swatches">{['Walnut', 'Linen', 'Graphite', 'Sage'].map((theme, i) => <span key={theme} data-selected={active === 2 && beat === i || undefined}><i />{t(theme)}</span>)}</div>
      </div>
      <div className="story-highlights story-demo" aria-hidden="true">
        <span className="story-demo-label">{t('A passage worth returning to')}</span>
        <p><mark>{t('Some sentences ask you to pause.')}</mark></p><p><u>{t('And some deserve a thought of your own.')}</u></p>
        <div className="story-highlight-tags"><span># {t('inspiration')}</span><span># {t('worth-remembering')}</span><i /><i /><i /></div>
      </div>
      <div className="book-floating-note" data-saving={active === 5 || undefined} aria-hidden="true">
        <div className="book-note-label"><span />{t('A note in the margin')}<span>{active === 4 ? 'Aa' : '✓'}</span></div>
        {(active === 4 || active === 5) && <Suspense fallback={<p>{t('A thought worth keeping')}</p>}><MarkdownDemo step={active === 5 ? 3 : beat} /></Suspense>}
        <span className="book-note-tag"># {t('inspiration')}</span>
        <div className="book-note-footer"><span>{active === 5 ? (beat < 2 ? t('Saving…') : t('Saved to your account')) : t('Example note · Markdown supported')}</span><span>{active === 5 && beat < 2 ? '···' : '✓'}</span></div>
      </div>
      <div className="story-save-orbit" aria-hidden="true"><svg viewBox="0 0 80 60" fill="none"><path d="M24 43H18a12 12 0 0 1-1-24 21 21 0 0 1 40-2 13 13 0 0 1 3 26H48" /><path d="m30 30 10-10 10 10M40 20v34" /></svg><span>{t('Auto-save')}</span></div>
      <div className="story-chat story-demo" data-step={active === 6 ? beat : 0} aria-hidden="true">
        <div className="story-agent-heading"><span className="story-agent-avatar"><Icon.book size={23} /></span><div><strong>{'Infinite'}</strong><span>{t('Your AI reading companion')}</span></div><span className="story-agent-badge">{'AGENT'}</span></div>
        <p className="story-chat-question">{t('Help me connect this passage to what came before.')}</p>
        <ol className="story-agent-actions">{['Check the contents', 'Find related passages', 'Read the source text'].map((label, i) => <li key={label} data-done={active === 6 && beat >= i || undefined}><i>{active === 6 && beat >= i ? '✓' : String(i + 1).padStart(2, '0')}</i>{t(label)}</li>)}</ol>
        <div className="story-agent-response">
          <span className="story-agent-working" data-visible={active !== 6 || beat < 2 || undefined}>{t('Looking for the connection in your book…')}</span>
          <div className="story-chat-answer" data-visible={active === 6 && beat >= 2 || undefined}><p>{t('Earlier, reading is described as an inward journey. Your questions and notes are a way to keep the thoughts you discover along the way.')}<sup>{'[1][2]'}</sup></p><div className="story-agent-sources"><span>{t('Sources in the book')}</span><span>{t('[1] Page 6')}</span><span>{t('[2] Page 7')}</span></div></div>
        </div>
        <div className="story-agent-followup" data-visible={active === 6 && beat >= 3 || undefined}><span>{t('How could I start a note?')}</span><Icon.send size={13} /></div>
        <div className="story-agent-footer"><span>{t('Ask again. Keep the context.')}</span><small>{t('Companion demo')}</small></div>
      </div>
      <div className="book-constellation" aria-hidden="true">
        <svg viewBox="0 0 600 420" fill="none"><path className="book-map-path" d="M110 210 C230 210 200 76 325 76 M110 210 H325 M110 210 C230 210 200 344 325 344" /><circle cx="110" cy="210" r="76" /><circle cx="110" cy="210" r="93" className="book-map-orbit" /></svg>
        <span className="book-map-core">{t('A book, understood')}</span>
        {['The central idea', 'The supporting details', 'Your own connections'].map((label, i) => <div className={`book-map-idea book-map-idea-${i}`} key={label}><small>0{i + 1}</small><span>{t(label)}</span><i /></div>)}
        <p>{t('Example mind map')}</p>
      </div>
      <div className="story-atlas-caption" aria-hidden="true"><span>{t('Globe & terrain')}</span><strong>{t('See the places in your book in 3D.')}</strong><small>{'Natural Earth'}</small></div>
      <div className="story-fullscreen" aria-hidden="true"><i /><i /><i /><i /><span>{t('Fullscreen')}<span>↗</span>{t('Fit to screen')}</span></div>
      <div className="book-stage-bottom">
        <span className="book-scroll-hint">{t('Scroll to unfold')}<span aria-hidden="true">↓</span></span>
        <nav className="book-chapters" aria-label={t('Reading preview')}>
          <button type="button" aria-label={t('Previous feature')} disabled={active === 0} onClick={() => go(active - 1)}>←</button>
          <span className="story-chapter-count">{String(active + 1).padStart(2, '0')} / {STORY_COUNT}</span>
          <select aria-label={t('Choose a feature')} value={active} onChange={event => go(Number(event.target.value))}>{chapters.map((chapter, i) => <option value={i} key={chapter.id}>{t(chapter.label)}</option>)}</select>
          <button type="button" aria-label={t('Next feature')} disabled={active === STORY_COUNT - 1} onClick={() => go(active + 1)}>→</button>
        </nav>
        <a className="book-try" href={sample}>{t('Open the reader')}<span aria-hidden="true">↗</span></a>
      </div>
      <div className="book-story-track" aria-hidden="true"><span /></div>
    </div>
  </section>
}
