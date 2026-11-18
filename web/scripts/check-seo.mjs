import assert from 'node:assert/strict';
const base=process.env.SEO_ORIGIN||'http://127.0.0.1:8788';
for(const locale of ['en','zh-CN']) {
 const response=await fetch(base+'/?lang='+locale);assert.equal(response.status,200);
 const html=await response.text();assert.ok(html.includes(`<html lang="${locale}">`));assert.ok(html.includes('<h1'));assert.ok(html.includes('id="questions"'));
 assert.ok(html.includes(`rel="canonical" href="https://ereader.space/?lang=${locale}"`));assert.ok(!html.includes('noindex'));
 assert.ok(html.includes(`hreflang="${locale==='en'?'zh-CN':'en'}"`));assert.equal(response.headers.get('content-language'),locale);
 const structured=html.match(/<script id="landing-structured-data" type="application\/ld\+json">(.*?)<\/script>/s);assert.ok(structured);JSON.parse(structured[1]);
 assert.ok(!html.includes('/src/'));assert.ok(!html.includes('/@fs/'));
 const image=html.match(/property="og:image" content="([^"]+)"/)[1];assert.equal((await fetch(base+new URL(image).pathname)).status,200);
 const sheets=[...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)];assert.ok(sheets.length);
 for(const sheet of sheets)assert.equal((await fetch(base+sheet[1])).status,200);
}
for(const p of ['/shelf','/book/test-id','/?sample=zh','/?auth_error=test','/index.html']){
 const r=await fetch(base+p);assert.equal(r.status,200,p);assert.ok(r.headers.get('x-robots-tag')?.includes('noindex'),p);assert.ok((await r.text()).includes('name="robots" content="noindex'));
}
for(const p of ['/_landing/en.html','/does-not-exist-seo-check'])assert.equal((await fetch(base+p)).status,404,p);
const sitemap=await (await fetch(base+'/sitemap.xml')).text();assert.equal((sitemap.match(/<loc>/g)||[]).length,8);assert.ok(!sitemap.includes('/book/'));assert.ok(!sitemap.includes('/shelf'));
for(const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g))assert.equal((await fetch(base+new URL(m[1]).pathname+new URL(m[1]).search)).status,200);
const robots=await (await fetch(base+'/robots.txt')).text();assert.ok(robots.includes('Sitemap: https://ereader.space/sitemap.xml'));
console.log('PASS raw bilingual HTML, metadata/schema/CSS/share images, sitemap routes, reader noindex and real 404 responses');
