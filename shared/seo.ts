import type { Locale } from './i18n'

export const SITE_ORIGIN = 'https://ereader.space'
export const PUBLIC_PATHS = ['/', '/about', '/privacy', '/terms'] as const
export const landingSeo = {
  en: {
    title: 'Infinite Reader — Online EPUB Reader with Notes & AI',
    description: 'Read EPUB books in your browser with natural page turns, highlights and inline notes. Explore your books with AI conversations, mind maps and chapter slides.',
  },
  'zh-CN': {
    title: 'Infinite Reader — 在线 EPUB 阅读器、读书笔记与 AI 阅读助手',
    description: '在浏览器中阅读 EPUB 电子书，体验自然翻页、划线与行内笔记。通过 AI 问答、思维导图和章节幻灯片，深入理解书中内容。',
  },
}
export const publicUrl = (path: string, locale: Locale) => `${SITE_ORIGIN}${path}?lang=${locale}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function seoHead(path: string, locale: Locale, title: string, description: string) {
  const image = `${SITE_ORIGIN}/landing/reader-${locale}.webp`
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${publicUrl(path, locale)}">
<link rel="alternate" hreflang="en" href="${publicUrl(path, 'en')}">
<link rel="alternate" hreflang="zh-CN" href="${publicUrl(path, 'zh-CN')}">
<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}${path}">
<meta property="og:site_name" content="Infinite Reader">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${publicUrl(path, locale)}">
<meta property="og:locale" content="${locale === 'zh-CN' ? 'zh_CN' : 'en_US'}">
<meta property="og:locale:alternate" content="${locale === 'zh-CN' ? 'en_US' : 'zh_CN'}">
<meta property="og:image" content="${image}">
<meta property="og:image:alt" content="${locale === 'zh-CN' ? 'Infinite Reader 电子书阅读界面' : 'Infinite Reader EPUB reading interface'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">`
}
export function landingStructuredData(locale: Locale) {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, name: 'Infinite Reader', url: SITE_ORIGIN + '/', inLanguage: ['en', 'zh-CN'] },
    { '@type': 'WebApplication', '@id': `${SITE_ORIGIN}/#application`, name: 'Infinite Reader', url: publicUrl('/', locale),
      description: landingSeo[locale].description, applicationCategory: 'EducationalApplication', operatingSystem: 'Web browser',
      inLanguage: ['en', 'zh-CN'], featureList: ['EPUB reading', 'Highlights and inline notes', 'AI reading companion', 'Mind maps', 'Chapter slides'] },
  ] }).replace(/</g, '\\u003c')
}
