// Verify the real browser outbox survives D1-style 500/503 responses and reload.
import assert from 'node:assert/strict'
const {default: puppeteer}=await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page=await browser.newPage()
let status=500
const accepted=[]
await page.setRequestInterception(true)
page.on('request',request=>{
  if(new URL(request.url()).pathname.startsWith('/api/books/outage-book/')){
    if(status===200)accepted.push({path:new URL(request.url()).pathname,method:request.method(),body:JSON.parse(request.postData()||'{}')})
    void request.respond({status,contentType:'application/json',body:JSON.stringify(status===200?{ok:true}:{error:{code:status===503?'database_unavailable':'internal_error',message:'Service unavailable'}})})
  }else void request.continue()
})
try{
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5173/shelf')
  await page.evaluate(async()=>{
    const {ApiAdapter}=await import('/src/storage/apiAdapter.ts')
    const adapter=new ApiAdapter();window.__outageAdapter=adapter
    await adapter.putAnnotation({id:'outage-mark',bookId:'outage-book',locator:{chapter:0,start:10,end:60},quote:'跨页原文',kind:'highlight',color:'pink',createdAt:1,updatedAt:1,note:{text:'未同步的笔记',font:'ma-shan-zheng',textColor:'blue',x:0,y:0,rot:0}})
    await adapter.flush()
  })
  const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('infinite-reader:outbox:v1')||'[]'))
  assert.equal((await snapshot())[0].a.note.text,'未同步的笔记');console.log('PASS HTTP 500 retains the complete highlight and note in the persistent outbox')
  status=503
  await page.reload({waitUntil:'domcontentloaded'})
  await page.evaluate(async()=>{const {ApiAdapter}=await import('/src/storage/apiAdapter.ts');window.__outageAdapter=new ApiAdapter();await window.__outageAdapter.replay()})
  assert.equal((await snapshot())[0].a.note.font,'ma-shan-zheng');console.log('PASS reload and HTTP 503 preserve pending changes')
  status=200
  await page.evaluate(()=>window.__outageAdapter.replay())
  assert.equal((await snapshot()).length,0)
  assert.ok(accepted.some(r=>r.method==='POST'&&r.path.endsWith('/annotations')&&r.body.anchor.start===10&&r.body.anchor.end===60))
  assert.ok(accepted.some(r=>r.method==='POST'&&r.path.endsWith('/notes')&&r.body.text==='未同步的笔记'&&r.body.anchor.font==='ma-shan-zheng'&&r.body.anchor.textColor==='blue'))
  console.log('PASS after service recovery, replay sends the original range and note before clearing the outbox')
}finally{await browser.close()}
