// Run against a production preview with the API backend; all auth responses are mocked.
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core');
import assert from 'node:assert/strict';
const browser = await puppeteer.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1440,height:900}});
const base=new URL(process.env.READER_URL || 'http://127.0.0.1:5202').origin;
async function pageWithAuth(mode, faults = {}) {
 const context=await browser.createBrowserContext(), page=await context.newPage();
 const requests=[], errors=[]; let pendingAuth, pendingProviders;
 page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',r=>{
  requests.push({url:r.url(),method:r.method()});
  const path=new URL(r.url()).pathname;
  const json=(data,status=200)=>r.respond({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(path==='/api/auth/me') {
   const respond=()=>mode==='user'?json({user:{id:'test-user',email:'test@example.test',name:'Test Reader'}}):json({error:{code:'unauthorized',message:'Unauthorized'}},401);
   if(mode==='pending') pendingAuth=respond; else void respond();
  } else if(path==='/api/auth/providers') pendingProviders=()=>json({email:true,google:false});
  else if(path==='/api/books') void json({books:[{id:'private-test',title:'Private test book',author:'Test',size:1,hasCover:false,status:'ready',chapterCount:1,chunkCount:1,indexedChunks:1,progress:null,createdAt:1}]});
  else if(path.startsWith('/api/')) void json({});
  else if (faults.reader && path.includes('ReaderWorkspace')) void r.abort('failed');
  else void r.continue();
 });
 return {page,context,requests,errors,releaseAuth:()=>pendingAuth?.(),releaseProviders:()=>pendingProviders?.()};
}
try {
 const guest=await pageWithAuth('pending');
 const start=Date.now(); await guest.page.goto(base+'/shelf?lang=zh-CN',{waitUntil:'domcontentloaded'});
 await guest.page.waitForSelector('.shelf-sample');
 const firstPaint=Date.now()-start;
 await new Promise(r=>setTimeout(r,500));
 assert.equal(await guest.page.$('.desk-canvas'),null);
 assert(!guest.requests.some(r=>/ReaderWorkspace|\/samples\//.test(r.url)));
 assert(!guest.requests.some(r=>r.method!=='GET'));
 console.log(JSON.stringify({case:'auth stalled',sampleVisibleMs:firstPaint,jsBytes:await guest.page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname.endsWith('.js')).reduce((a,r)=>a+r.encodedBodySize,0)),noScene:true}));
 await guest.releaseAuth();
 await guest.page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='登录'));
 assert(await guest.page.$('.shelf-sample'));
 assert(!guest.requests.some(r=>r.url.includes('/api/auth/providers')));
 console.log('PASS public shelf does not request login providers');
 await guest.page.click('[aria-label="登录"]');
 await guest.page.waitForSelector('.welcome.login');
 console.log('PASS login form appears while provider configuration is stalled');

 await guest.context.close();
 const user=await pageWithAuth('user');
 await user.page.goto(base+'/shelf?lang=en',{waitUntil:'domcontentloaded'});
 await user.page.waitForFunction(()=>document.body.textContent.includes('Private test book'));
 assert.equal(await user.page.$('.shelf-samples'),null);
 assert.equal(await user.page.$('.desk-canvas'),null);
 assert.equal(user.errors.length,0,JSON.stringify(user.errors));
 console.log('PASS authenticated shelf: cloud library appears without initializing reader');
 await user.context.close();
 const sample=await pageWithAuth('anon');
 await sample.page.goto(base+'/shelf?sample=alice&lang=en',{waitUntil:'domcontentloaded'});
 await sample.page.waitForFunction(()=>window.__store?.getState().current && !window.__store.getState().loading,{timeout:90000});
 assert(await sample.page.$('.desk-canvas'));
 assert.match(sample.page.url(),/\/book\//);
 const book=await sample.page.evaluate(()=>({title:window.__store.getState().current.meta.title,pages:window.__store.getState().leafCount,mode:window.__store.getState().session.status}));
 assert(book.pages>0); assert.equal(book.mode,'local');
 await sample.page.evaluate(()=>window.__store.getState().returnToShelf());
 await sample.page.waitForSelector('.shelf');
 assert.equal(sample.errors.length,0,JSON.stringify(sample.errors));
 console.log(JSON.stringify({case:'open sample, render, return to shelf',...book}));
 await sample.context.close();
 const deep=await pageWithAuth('anon');
 await deep.page.goto(base+'/book/private-test?lang=en',{waitUntil:'domcontentloaded'});
 await deep.page.waitForFunction(()=>document.body.textContent.includes('Sign in'));
 assert(deep.page.url().includes('/book/private-test'));
 assert(!deep.requests.some(r=>r.url.includes('/api/books/private-test/file')));
 console.log('PASS signed-out private deep link: preserved URL and no file request');
 await deep.context.close();
 const faults={reader:true};
 const failed=await pageWithAuth('anon', faults);
 await failed.page.goto(base+'/shelf?sample=alice&lang=en',{waitUntil:'domcontentloaded'});
 await failed.page.waitForSelector('.loading[role="alert"] button');
 assert(await failed.page.$eval('.loading[role="alert"] button', button => button.getBoundingClientRect().height > 0), 'reader failure must expose a usable retry action');
 faults.reader=false;
 await failed.page.click('.loading[role="alert"] button');
 await failed.page.waitForFunction(()=>window.__reader?.hasBook && !window.__store.getState().loading,{timeout:90000});
 console.log('PASS reader chunk failure: visible retry recovers the requested sample');
 await failed.context.close();
} finally {await browser.close()}
