// Run Vite with VITE_BACKEND=api. All auth calls are intercepted: no real emails or accounts.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath:process.env.CHROME_BIN || '/usr/bin/chromium', headless:true, args:['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader'], defaultViewport:{width:1280,height:900} })
const page = await browser.newPage()
page.setDefaultTimeout(30000)
const calls = [], errors = []
let legacy = false
page.on('pageerror', e => errors.push(e.message))
await page.setRequestInterception(true)
page.on('request', request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) return void request.continue()
  if (url.pathname === '/api/auth/google/start' && request.method() === 'GET' && process.env.LIVE_LEGACY_ENTRY) return void request.continue()
  const body = request.postData() ? JSON.parse(request.postData()) : undefined
  calls.push({path:url.pathname,method:request.method(),body})
  const json = (data, status=200) => request.respond({status,contentType:'application/json',body:JSON.stringify(data)})
  if (url.pathname === '/api/auth/me') return void json({error:{code:legacy?'terms_required':'unauthorized',message:'Sign in required'}},legacy?403:401)
  if (url.pathname === '/api/auth/providers') return void json({email:true,google:true})
  if (url.pathname === '/api/auth/email/request') return void json({ok:true,expiresInSec:600})
  if (url.pathname === '/api/auth/email/verify') return void json({user:{id:'test',email:'test@example.com',name:null,avatar_url:null}})
  if (url.pathname === '/api/auth/google/start') return void json({error:{code:'test_stop',message:'Test stops before leaving for Google.'}},400)
  if (url.pathname === '/api/costs') return void json({error:{code:'test_unavailable',message:'Cost diagnostics not part of this fixture'}},503)
  if (url.pathname === '/api/books') return void json({books:[]})
  return void json({ok:true})
})
const check = (condition,label) => { assert.ok(condition,label);console.log('PASS',label) }

try {
  const base = process.env.READER_URL || 'http://127.0.0.1:5174/'
  const entry = process.env.LIVE_LEGACY_ENTRY ? '/api/auth/google/start?next=%2F' : '/?auth_error=terms_required'
  await page.goto(new URL(entry,base).href,{waitUntil:'domcontentloaded'})
  await page.waitForSelector('.terms-consent input')
  check((await page.$eval('.login .error',e=>e.textContent)).includes('accept the Terms'), 'legacy Google entry automatically opens the consent dialog')
  check(new URL(page.url()).pathname === '/shelf', 'legacy entry returns to the reader and clears the error URL')
  check(await page.$eval('.terms-consent input', e=>!e.checked), 'consent starts unchecked')
  await page.type('input[type=email]', 'test@example.com')
  check(await page.$eval('.auth-form .primary',e=>e.disabled) && await page.$eval('.btn.google',e=>e.disabled), 'both sign-in methods are disabled without consent')
  await page.$eval('.auth-form', e=>e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  check(!calls.some(c=>c.path.endsWith('/email/request')), 'form submission cannot bypass the consent guard')
  check(await page.$eval('.terms-consent a',e=>e.getAttribute('href').startsWith('/terms?version=')&&e.target==='_blank'), 'terms remain readable in a separate tab before accepting')
  await page.click('.terms-consent input')
  check(await page.$eval('.btn.google',e=>!e.disabled), 'explicit checkbox enables Google')
  await page.click('.btn.google')
  await page.waitForSelector('.login .error')
  const google = calls.find(c=>c.path.endsWith('/google/start'))
  check(google?.method === 'POST' && google.body.terms.accepted===true && !!google.body.terms.version, 'Google sends explicit versioned consent through POST')
  await page.click('.auth-form .primary')
  await page.waitForSelector('input.code')
  await page.type('input.code','123456')
  await page.click('.terms-consent input')
  check(await page.$eval('.auth-form .primary',e=>e.disabled), 'unchecking consent also disables code verification')
  await page.$eval('.auth-form', e=>e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  check(!calls.some(c=>c.path.endsWith('/email/verify')), 'code submission cannot bypass the consent guard')
  await page.click('.terms-consent input')
  await page.click('.auth-form .primary')
  await page.waitForSelector('.login',{hidden:true})
  const email = calls.find(c=>c.path.endsWith('/email/verify'))
  check(email.body.terms.accepted===true && email.body.terms.version===google.body.terms.version, 'email login sends the same accepted version')
  await page.evaluate(()=>window.__store.setState({session:{status:'local'},showLogin:true}))
  await page.waitForSelector('.terms-consent input')
  check(await page.$eval('.terms-consent input',e=>!e.checked), 'reopening sign-in requires a new explicit check')
  await page.click('.terms-consent input')
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
  await page.waitForFunction(()=>!document.querySelector('.terms-consent input').checked)
  check(await page.$eval('.terms-consent input',e=>!e.checked), 'restoring from browser back/forward cache does not retain consent')
  await fs.mkdir('/tmp/tou-screenshots',{recursive:true})
  await page.screenshot({path:'/tmp/tou-screenshots/login-desktop.png'})
  await page.setViewport({width:390,height:844})
  await page.screenshot({path:'/tmp/tou-screenshots/login-mobile.png'})
  check(await page.$eval('.login .card',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}), 'consent dialog fits a narrow screen')
  legacy = true
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForSelector('.terms-consent input')
  check((await page.$eval('.login .error',e=>e.textContent)).includes('accept the Terms'), 'legacy session is prompted to sign in and accept the terms')
  check(await page.$eval('.terms-consent input',e=>!e.checked), 'legacy consent is never preselected')
  legacy = false
  const bookPath = '/book/11111111-1111-4111-8111-111111111111'
  const bookEntry = process.env.LIVE_LEGACY_ENTRY ? '/api/auth/google/start?next=' + encodeURIComponent(bookPath) : bookPath + '?auth_error=terms_required'
  await page.goto(new URL(bookEntry,base).href,{waitUntil:'domcontentloaded'})
  await page.waitForSelector('.terms-consent input')
  check(new URL(page.url()).pathname === bookPath, 'legacy deep link keeps the requested book')
  check(await page.$eval('.terms-consent input',e=>!e.checked), 'legacy deep link never preselects consent')
  await page.click('.terms-consent input')
  const resumedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/google/start' && response.request().method() === 'POST')
  await page.click('.btn.google')
  await resumedResponse
  // Unknown server errors are intentionally localized, not shown verbatim.
  await page.waitForFunction(()=>document.querySelector('.login .error') && !document.querySelector('.btn.google').disabled)
  const resumed = calls.filter(c=>c.path.endsWith('/google/start')).at(-1)
  check(resumed.method === 'POST' && resumed.body.next === bookPath && resumed.body.terms.accepted === true, 'recovered login uses the consent-bearing POST and keeps the book return path')
  if (process.env.LEGAL_URL) {
    const legal = await browser.newPage()
    await legal.setViewport({width:390,height:844})
    await legal.goto(process.env.LEGAL_URL,{waitUntil:'domcontentloaded'})
    check((await legal.$eval('main',e=>e.textContent)).includes('使用条款'), 'published TOU includes Chinese and English text')
    check(await legal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'TOU fits a mobile viewport')
    await legal.screenshot({path:'/tmp/tou-screenshots/terms-mobile.png'})
  }
  check(errors.length===0, `no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
