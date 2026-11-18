import { useEffect } from 'react'
import { LandingExperience } from './LandingExperience'
import { localeUrl, useLocale, useT } from '../i18n'
import { LanguageSwitch } from '../i18n/LanguageSwitch'
import { syncLandingSeo } from '../seo'
import '@fontsource-variable/inter'
import '@fontsource-variable/eb-garamond'
import '@fontsource-variable/eb-garamond/wght-italic.css'
import '@fontsource-variable/noto-serif-sc'
import './landing.css'

const Arrow = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
const Book = () => <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 8c-4-4-9-3-12-2v19c4-2 8-2 12 1 4-3 8-3 12-1V6c-3-1-8-2-12 2Zm0 0v18" /><path d="M8 11c2-.5 3 0 4 1m8 0c1-1 2-1.5 4-1" /></svg>
const Spark = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z" /></svg>
const currentYear = new Date().getFullYear()

export default function Landing() {
  const t = useT(), locale = useLocale()
  const sample = localeUrl(`/shelf?sample=${locale === 'zh-CN' ? 'zh' : 'alice'}`)
  const shelf = localeUrl('/shelf')
  useEffect(() => {
    syncLandingSeo(locale)
  }, [locale])
  return <div className="landing" lang={locale}>
    <a className="landing-skip" href="#landing-main">{t('Skip to content')}</a>
    <header className="landing-nav landing-wrap">
      <a className="landing-brand" href={localeUrl('/')} aria-label={t('Infinite Reader home')}><Book /><span>Infinite Reader<span className="landing-brand-dot">.</span></span></a>
      <nav className="landing-nav-links" aria-label={t('Main navigation')}>
        <a href="#experience">{t('The experience')}</a><a href="#possibilities">{t('Beyond the page')}</a><a href="#questions">{t('FAQ')}</a>
      </nav>
      <div className="landing-nav-actions"><LanguageSwitch /><a className="landing-nav-enter" href={shelf}>{t('My shelf')}<Arrow /></a></div>
    </header>
    <main id="landing-main">
      <section className="landing-hero landing-wrap" aria-labelledby="landing-title">
        <div className="landing-hero-heading">
          <p className="landing-eyebrow"><span />{t('A little space. Infinite possibilities.')}</p>
          <h1 id="landing-title">{t('A book opens.')}<br /><em>{t('A world unfolds.')}</em></h1>
        </div>
        <div className="landing-hero-copy">
          <p>{t('Settle into a good book. Leave a thought in the margin. Follow a question a little further.')}</p>
          <p className="landing-hero-sub">{t('A considered home for your EPUBs, your ideas, and everything in between.')}</p>
          <div className="landing-actions"><a className="landing-primary" href={shelf}>{t('Start reading')}<Arrow /></a><a className="landing-text-link" href={sample}>{t('Try a sample book')}<Arrow /></a></div>
          <span className="landing-small-note">{t('In your browser. At your own pace.')}</span>
        </div>
      </section>
      <LandingExperience sample={sample} />
      <section className="landing-intro landing-wrap" id="possibilities">
        <p className="landing-eyebrow">{t('Not just a place to keep books.')}</p>
        <h2>{t('A place to stay with them.')}</h2>
        <p>{t('Reading is more than reaching the last page. It is noticing, questioning, and making connections that stay with you.')}</p>
      </section>
      <section className="landing-features landing-wrap" aria-label={t('Reading features')}>
        <article className="landing-feature landing-feature-reading">
          <span className="landing-feature-number">01 /</span><h3>{t('Make yourself at home.')}</h3><p>{t('Warm paper, natural page turns, and a desk that feels like yours. Choose your typeface and theme, then let the interface fall away.')}</p>
          <div className="landing-type-study" aria-hidden="true"><span>{'Aa'}</span><span>{t('Read')}</span><div><i /><i /><i /><i /></div></div>
          <span className="landing-feature-foot">{t('Your books. Your reading rhythm.')}</span>
        </article>
        <article className="landing-feature landing-feature-notes">
          <span className="landing-feature-number">02 /</span><h3>{t('Let a thought take root.')}</h3><p>{t('Highlight a line. Write beside it. Shape your notes with Markdown and revisit related ideas through tags. Your thoughts belong with the words that sparked them.')}</p>
          <div className="landing-note-study"><p><mark>{t('Some sentences ask you to pause.')}</mark></p><div><span>{t('And some deserve a thought of your own.')}</span><small># {t('worth-remembering')}</small></div></div>
          <span className="landing-feature-foot">{t('Highlights, inline notes & tags')}</span>
        </article>
        <article className="landing-feature landing-feature-ai">
          <span className="landing-feature-number">03 /</span><h3>{t('Follow your curiosity.')}</h3><p>{t('Ask Infinite about a passage, explore an idea in context, or turn a chapter into a mind map. A reading companion, there when you want to go deeper.')}</p>
          <div className="landing-question-study"><Spark /><span>{t('What is the idea behind this passage?')}</span><Arrow /></div>
          <div className="landing-ai-trail" aria-hidden="true"><span>{t('Passage')}</span><i /><span>{t('Question')}</span><i /><span>{t('Perspective')}</span></div>
          <span className="landing-feature-foot">{t('AI conversations & saved mind maps')}</span>
        </article>
      </section>
      <section className="landing-how landing-wrap" aria-labelledby="landing-how-title">
        <div><p className="landing-eyebrow">{t('A new reading ritual')}</p><h2 id="landing-how-title">{t('Bring a book.')}<br /><em>{t('Make room for an idea.')}</em></h2></div>
        <ol>{[['Bring your own library.', 'Sign in and add an EPUB to your shelf. Or start with a sample and look around.'], ['Find your reading rhythm.', 'Set your typeface, settle into your desk, and turn the first page.'], ['Keep what stays with you.', 'Save a thought, ask a question, and return to the ideas that matter.']].map(([title, text], i) => <li key={title}><span>0{i + 1}</span><div><h3>{t(title)}</h3><p>{t(text)}</p></div></li>)}</ol>
      </section>
      <section className="landing-faq landing-wrap" id="questions" aria-labelledby="landing-faq-title"><div><p className="landing-eyebrow">{t('Before the first page')}</p><h2 id="landing-faq-title">{t('A few good questions.')}</h2></div><div>{[
        ['What can I read here?', 'Infinite Reader is built for EPUB books. Sign in to upload your own EPUB files; PDFs and other formats are not currently supported.'],
        ['Can I try it before signing in?', 'Yes. Open a sample book and explore the reading experience without an account. Sign in when you are ready to add your own books.'],
        ['Will my notes be saved?', 'Notes save automatically as you edit. Books, highlights, notes, and AI conversations in your signed-in account are saved to the cloud. Sample reading while signed out stays in this browser.'],
        ['Do I need to use AI?', 'Only when you want to. AI questions and mind maps are optional. Turning pages, highlighting, and editing notes do not call a language model.'],
      ].map(([question, answer]) => <details key={question}><summary>{t(question)}<span aria-hidden="true">+</span></summary><p>{t(answer)}</p></details>)}</div></section>
      <section className="landing-closing"><div className="landing-wrap"><Book /><p className="landing-eyebrow">{t('There is a world waiting in your next book.')}</p><h2>{t('Turn the first page.')}</h2><a className="landing-primary" href={shelf}>{t('Enter your reading space')}<Arrow /></a><a className="landing-closing-sample" href={sample}>{t('Or take a look with a sample book')}<Arrow /></a></div><span className="landing-closing-orbit" aria-hidden="true" /></section>
    </main>
    <footer className="landing-footer landing-wrap"><a className="landing-brand" href={localeUrl('/')}><Book /><span>Infinite Reader<span>.</span></span></a><p>{t('For the books you read. And the person you become.')}</p><nav aria-label={t('Footer navigation')}><a href={localeUrl('/about')}>{t('About')}</a><a href={localeUrl('/privacy')}>{t('Privacy Policy')}</a><a href={localeUrl('/terms')}>{t('Terms of Use')}</a></nav><small>© {currentYear} Infinite Reader</small></footer>
  </div>
}
