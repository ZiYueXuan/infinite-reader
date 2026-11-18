import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { isLandingRoute } from './route/entry'
import { t } from './i18n'
import './index.css'

// The public page loads its own optional showcase, without reader storage or account initialization.
const landing = isLandingRoute(location.pathname, location.search)
if (!landing) {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b0705')
}
const render = (Page: React.ComponentType) => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="entry-loading" role="status"><span>Infinite Reader</span><small>{t('Loading…')}</small></div>}>
      <Page />
    </Suspense>
  </StrictMode>,
)
// Keep the complete prerendered page visible while the interactive bundle loads.
if (landing) void import('./ui/Landing').then(({ default: Page }) => render(Page))
else render(lazy(() => import('./App')))
