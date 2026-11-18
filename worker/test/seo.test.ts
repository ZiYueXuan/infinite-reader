import { describe, expect, it } from 'vitest'
import { siteEntry } from '../src/publicSite'
import { seoHead, landingStructuredData } from '../../shared/seo'
import { Client, makeEnv } from './helpers'

describe('public search metadata and reader indexing boundaries', () => {
  it('serves the chosen prerender while retaining legacy reader links and noindex on private shells', async () => {
    for (const [url, asset, privatePage] of [
      ['/?lang=zh-CN', '/_landing/zh-CN.html', false],
      ['/?lang=en', '/_landing/en.html', false],
      ['/shelf', '/index.html', true], ['/book/private-id', '/index.html', true],
      ['/?sample=zh', '/index.html', true], ['/?auth_error=cancelled', '/index.html', true],
    ] as const) {
      const assets = { fetch: async (request: Request) => {
        expect(new URL(request.url).pathname).toBe(asset)
        return new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html' } })
      } } as unknown as Fetcher
      const response = await siteEntry(new Request('https://ereader.space' + url), assets)
      expect(response.headers.get('x-robots-tag')).toBe(privatePage ? 'noindex, follow' : null)
      expect(response.headers.get('cache-control')).toContain('no-store')
      if (!privatePage) expect(response.headers.get('vary')).toContain('Accept-Language')
    }
  })
  it('gives every public information page canonical and reciprocal language URLs in its initial HTML', async () => {
    const client = new Client(makeEnv())
    for (const path of ['about', 'privacy', 'terms']) for (const locale of ['en', 'zh-CN']) {
      const response = await client.fetch(`/${path}/?lang=${locale}&tracking=ignored`)
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(html).toContain(`rel="canonical" href="https://ereader.space/${path}?lang=${locale}"`)
      for (const lang of ['en', 'zh-CN']) expect(html).toContain(`hreflang="${lang}" href="https://ereader.space/${path}?lang=${lang}"`)
      expect(html).toContain('property="og:image"')
      expect(html).not.toContain('tracking=ignored')
    }
  })
  it('escapes head data and describes the real application without invented ratings', () => {
    const head = seoHead('/', 'en', '<script>" & title', '<unsafe>')
    expect(head).toContain('&lt;script&gt;&quot; &amp; title')
    expect(head).not.toContain('<unsafe>')
    const data = JSON.parse(landingStructuredData('zh-CN'))
    expect(data['@graph'].map((item: any) => item['@type'])).toEqual(['WebSite', 'WebApplication'])
    expect(JSON.stringify(data)).not.toContain('aggregateRating')
  })
  it('rejects direct prerender artifact URLs and marks API responses noindex', async () => {
    const client = new Client(makeEnv())
    expect((await client.fetch('/_landing/en.html')).status).toBe(404)
    expect((await client.fetch('/api/health')).headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
})
