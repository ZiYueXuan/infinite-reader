import { landingSeo, seoHead, landingStructuredData } from '../../shared/seo'
import type { Locale } from './i18n/runtime'

/** Keep metadata in sync when the visitor switches the landing-page language. */
export function syncLandingSeo(locale: Locale) {
  const copy = landingSeo[locale], template = document.createElement('template')
  template.innerHTML = seoHead('/', locale, copy.title, copy.description)
  for (const node of Array.from(template.content.children)) {
    const selector = node.tagName === 'TITLE' ? 'title'
      : node.tagName === 'LINK' ? `link[rel="${node.getAttribute('rel')}"]${node.hasAttribute('hreflang') ? `[hreflang="${node.getAttribute('hreflang')}"]` : ''}`
      : `meta[${node.hasAttribute('property') ? 'property' : 'name'}="${node.getAttribute('property') ?? node.getAttribute('name')}"]`
    const previous = document.head.querySelector(selector)
    if (previous) previous.replaceWith(node)
    else document.head.append(node)
  }
  document.querySelector('meta[name="robots"]')?.remove()
  let structured = document.querySelector<HTMLScriptElement>('#landing-structured-data')
  if (!structured) { structured = document.createElement('script'); structured.id = 'landing-structured-data'; structured.type = 'application/ld+json'; document.head.append(structured) }
  structured.textContent = landingStructuredData(locale)
}
