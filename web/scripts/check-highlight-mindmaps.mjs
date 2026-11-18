// Intercepted API + real highlight toolbar/dialog; no paid inference or private book data.
import assert from 'node:assert/strict'
import { checkMindmapConnections } from './mindmap-connection-helpers.mjs'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:900}})
const page = await browser.newPage(), errors = []
page.setDefaultTimeout(30000)
page.on('pageerror', e => errors.push(e.message))
await page.evaluateOnNewDocument(() => localStorage.setItem('ir:locale','zh-CN'))
const bookId='22222222-2222-4222-8222-222222222222', saved=new Map(), annotations=new Map()
let posts=0, generationBeforeSave=false
const tree={text:'划线观点',children:[{text:'文学表达的变化',children:[{text:'白话文的传播',children:[]}]},{text:'观念的传播',children:[]}]}
await page.setRequestInterception(true)
page.on('request',req=>{
  const url=new URL(req.url()), json=(body,status=200)=>req.respond({status,contentType:'application/json',body:JSON.stringify(body)})
  if(!url.pathname.startsWith('/api/')) return void req.continue()
  if(url.pathname==='/api/auth/me') return void json({user:{id:'highlight-user',email:'test@example.com',name:null,avatar_url:null}})
  if(url.pathname==='/api/books') return void json({books:[]})
  if(url.pathname.endsWith('/annotations')&&req.method()==='POST') {
    const ann=JSON.parse(req.postData());annotations.set(ann.id,ann)
    return void setTimeout(()=>json({annotation:ann},201),100)
  }
  if(url.pathname.endsWith('/mindmaps')) return void json({readyTargets:[...saved.keys()],pending:false})
  if(url.pathname.endsWith('/mindmap')) {
    const target=req.method()==='GET'?url.searchParams.get('target'):JSON.parse(req.postData()).target
    if(req.method()==='GET') return void json(saved.has(target)?{status:'ready',cached:true,result:saved.get(target)}:{status:'missing'})
    posts++
    const annotationId=target.slice('annotation:'.length), annotation=annotations.get(annotationId)
    if(!annotation) generationBeforeSave=true
    const result={tree,title:'划线观点',source:{annotationId,quote:annotation?.text||''},model:'deepseek-flash',operationId:'test-'+posts,generatedAt:Date.now()}
    return void setTimeout(()=>{saved.set(target,result);void json({status:'ready',result,cached:false})},500)
  }
  if(url.pathname==='/api/costs') return void json({error:{code:'fixture',message:'No costs fixture'}},503)
  return void json({ok:true})
})
const check=(v,label)=>{assert.ok(v,label);console.log('PASS',label)}
async function openFixture(lang='zh-CN') {
  await page.goto((process.env.READER_URL||'http://127.0.0.1:5175/shelf').replace(/\?.*$/, '')+'?lang='+lang,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__store?.getState().session.status==='user')
  await page.evaluate(bookId=>{
    const text='白话文改变了文学的表达方式，也使新的观念能够传播给更多读者。'
    const current={meta:{id:bookId,title:'文学史',author:'Test',language:'zh',status:'ready'},parsed:{meta:{title:'文学史'},chapters:[{index:0,title:'第一章',href:'chapter.xhtml',textLength:text.length,blocks:[{kind:'p',text,start:0,runs:[{text}]}]}],toc:[],getImage:async()=>null}}
    const annotation={id:'highlight-map-01',bookId,locator:{chapter:0,start:0,end:text.length},quote:text,kind:'highlight',color:'green',createdAt:1,updatedAt:1}
    window.__store.setState({current,loading:null,showLogin:false,panel:'none',annotations:[annotation],popover:{kind:'mark',id:annotation.id,rect:{left:400,top:350,width:300,height:30}}})
  },bookId)
  await page.waitForSelector('[data-mark-mindmap]')
}
async function showMark(id='highlight-map-01') {
  await page.evaluate(id=>window.__store.getState().setPopover({kind:'mark',id,rect:{left:400,top:350,width:300,height:30}}),id)
  await page.waitForSelector('[data-mark-mindmap]')
}
try {
  await openFixture()
  check(await page.$eval('[data-mark-mindmap]',e=>e.getAttribute('aria-label')==='生成划线思维导图'),'new highlight offers generation')
  await page.click('[data-mark-mindmap]')
  await page.waitForSelector('.mindmap-dialog[open]')
  await page.keyboard.press('Escape')
  await showMark()
  await page.click('[data-mark-mindmap]')
  await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts===1&&!generationBeforeSave,'new annotation is synced before generation; rapid close/reopen coalesces the paid request')
  check(await page.$eval('.mindmap-dialog',e=>{const r=e.getBoundingClientRect();return r.width===innerWidth&&r.height===innerHeight}),'highlight map fills the reading area')
  await page.click('.mindmap-source summary')
  check(await page.$eval('.mindmap-source blockquote',e=>e.textContent.includes('白话文')),'saved original passage is available alongside the diagram')
  await page.keyboard.press('Escape');await showMark()
  await page.waitForSelector('[data-mark-mindmap].is-ready')
  check(await page.$eval('[data-mark-mindmap]',e=>e.getAttribute('aria-label').includes('已保存')&&!!e.querySelector('.toc-mindmap-check')),'completed highlight has a distinct checked view button')
  await page.click('[data-mark-mindmap]');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts===1&&await page.$eval('.mindmap-toolbar',e=>e.textContent.includes('无新增 AI')),'saved button reopens without another AI call')
  await openFixture();await page.waitForSelector('[data-mark-mindmap].is-ready')
  await page.click('[data-mark-mindmap]');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts===1,'saved highlight status and diagram survive full reload')
  await page.keyboard.press('Escape')
  await page.evaluate(()=>{const s=window.__store.getState();window.__store.setState({annotations:[{...s.annotations[0],color:'pink',kind:'underline'}]})})
  await showMark();await page.waitForSelector('[data-mark-mindmap].is-ready')
  await page.click('[data-mark-mindmap]');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts===1,'changing color and mark style keeps the saved diagram')
  await page.keyboard.press('Escape')
  await page.evaluate(()=>{const s=window.__store.getState();window.__store.setState({annotations:[...s.annotations,{...s.annotations[0],id:'highlight-map-02',quote:'第二条划线有独立的观点。'}]})})
  await showMark('highlight-map-02')
  check(await page.$eval('[data-mark-mindmap]',e=>!e.classList.contains('is-ready')),'a different highlight has its own generation state')
  await page.click('[data-mark-mindmap]');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(posts===2&&await page.$eval('.mindmap-source blockquote',e=>e.textContent==='第二条划线有独立的观点。'),'different highlights produce separate saved diagrams and source snapshots')
  await page.keyboard.press('Escape')
  await page.setViewport({width:390,height:844});await showMark()
  check(await page.$eval('.mark-popover',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}),'toolbar including map button fits a narrow viewport')
  await page.screenshot({path:'/tmp/highlight-map-toolbar.png'})
  await page.click('[data-mark-mindmap]');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(await page.$eval('.mindmap-dialog',e=>{const r=e.getBoundingClientRect();return r.width===innerWidth&&r.height===innerHeight}),'highlight map also fills mobile reading area')
  await page.screenshot({path:'/tmp/highlight-map-mobile.png'})
  await page.keyboard.press('Escape')
  await openFixture('en');await page.waitForSelector('[data-mark-mindmap].is-ready')
  const translated = await page.$eval('[data-mark-mindmap]',e=>({label:e.getAttribute('aria-label'),locale:document.documentElement.lang,url:location.href}))
  check(translated.label==='View highlight mind map (saved)','saved toolbar action is translated to English: '+JSON.stringify(translated))
  await page.click('[data-mark-mindmap]');await page.waitForSelector('.mindmap-tree'); await checkMindmapConnections(page)
  check(await page.$eval('.mindmap-source summary',e=>e.textContent==='Highlighted passage'),'source disclosure is translated without translating the book text')
  await page.keyboard.press('Escape')
  await page.evaluate(()=>window.__store.setState({session:{status:'local'}}));await showMark()
  await page.click('[data-mark-mindmap]')
  check(!await page.$('.mindmap-dialog[open]')&&posts===2,'local books cannot accidentally invoke paid generation')
  check(errors.length===0,'no browser runtime errors: '+errors.join('; '))
} finally {await browser.close()}
