import { requestLocale } from '../../shared/i18n'

/** Serve public prerenders and private app shells without running reader/account code. */
export async function siteEntry(request: Request, assets: Fetcher): Promise<Response> {
  const url = new URL(request.url)
  const landing = url.pathname === '/' && !url.searchParams.has('sample') && !url.searchParams.has('auth_error')
  const locale = requestLocale(request)
  const assetUrl = new URL(landing ? `/_landing/${locale}.html` : '/index.html', url.origin)
  const asset = await assets.fetch(new Request(assetUrl, { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }))
  const response = new Response(asset.body, asset)
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('x-content-type-options', 'nosniff')
  if (landing) {
    response.headers.set('content-language', locale)
    response.headers.set('vary', 'Cookie, Accept-Language')
  } else response.headers.set('x-robots-tag', 'noindex, follow')
  return response
}
