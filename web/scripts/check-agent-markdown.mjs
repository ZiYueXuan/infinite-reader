// Real Agent UI with intercepted history/stream fixtures. No paid requests or user accounts.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE || 'puppeteer-core')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox','--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader'], defaultViewport: { width:1280, height:900 } })
const page = await browser.newPage(), errors = []
page.setDefaultTimeout(60000)
page.on('pageerror', e => errors.push(e.message))
const bookId = '11111111-1111-4111-8111-111111111111'
const citation = { n:2,chunkId:'c',ordinal:0,chapterIndex:0,chapterTitle:'成本结构',chapterHref:'chapter.xhtml',charStart:0,charEnd:12,snippet:'这是用于验证引用跳转的原文。',score:1 }
const webCitation = { kind:'web', n:3, url:'https://example.com/research', title:'External research', snippet:'Public search excerpt.', retrievedAt:1 }
const brokenAnswer = 'I will read the passage.\n<｜DSML｜calls><｜DSML｜invoke name="read_book_passage"><｜DSML｜parameter name="chapter" string="false">5</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>'
const markdown = [
  '# 大模型推理的成本结构', '## 一、五层蛋糕：单位 Token 成本',
  '这是 **粗体与 *嵌套斜体***、~~删除线~~，书籍引用[2]与脚注[^note]。',
  '外部研究[3]，以及不安全的来源[4]。',
  '也可以看出**“联队”是核心战术单位**（约相当于团）。',
  '| 层级 | 包含内容 | 占 Token 总成本 |\n| :--- | :--- | ---: |\n| ① 能源 | 计算、冷却、网络传输的电力 | **10%～20%** |\n| ② 芯片 | GPU、HBM、NVLink/NVSwitch、DPU/NIC | **40%～55%** [2] |',
  '### 列表\n\n3. 有序列表\n   - 嵌套列表\n4. 下一项\n\n- [x] 已完成\n- [ ] 待完成',
  '> 引用\n>\n> > 嵌套引用',
  '---',
  '行内代码 `[2] <literal>` 与公式 $E=mc^2$。',
  '$$\n\\frac{a+b}{c}=\\sum_{i=1}^{n} i\n$$',
  '```javascript\nconst value = "[2]";\nconsole.log("A long line: '+ '0123456789'.repeat(15) +'");\n```',
  '[外部链接](https://example.com "Example") 与 https://example.org。',
  '![示意图片](/markdown-fixture.png)',
  '| A | B | C | D | E |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |',
  '<details><summary>展开补充</summary>安全的 <kbd>HTML</kbd> 内容。</details>',
  '<img src="/markdown-fixture.png" onerror="window.__unsafe=true"><script>window.__unsafe=true</script><a href="javascript:window.__unsafe=true">unsafe</a>',
  '```mermaid\nflowchart LR\n A[Input] --> B[Output]\n```',
  '```mermaid\nnot a diagram\n```',
  '[^note]: 这是 Markdown 脚注，**可正确排版**。',
].join('\n\n')
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text } } })
})
await page.setRequestInterception(true)
page.on('request', req => {
  const url = new URL(req.url()), json = (body,status=200) => req.respond({status,contentType:'application/json',body:JSON.stringify(body)})
  if (url.pathname === '/markdown-fixture.png') return void req.respond({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=','base64')})
  if (!url.pathname.startsWith('/api/')) return void req.continue()
  if (url.pathname === '/api/auth/me') return void json({user:{id:'markdown-user',email:'test@example.com',name:null,avatar_url:null}})
  if (url.pathname === '/api/auth/providers') return void json({email:true,google:true})
  if (url.pathname === '/api/books') return void json({books:[]})
  if (url.pathname.endsWith('/chat')) return void json({messages:[{id:'answer',role:'assistant',content:markdown,citations:[citation,webCitation,{...webCitation,n:4,url:'javascript:alert(1)'}],selection:null},{id:'second',role:'assistant',content:'Second message[^note].\n\n[^note]: Separate footnote.',citations:[],selection:null},{id:'legacy-protocol',role:'assistant',content:brokenAnswer,citations:[],selection:null}],pending:null})
  if (url.pathname === '/api/costs') return void json({error:{code:'fixture',message:'No cost fixture'}},503)
  return void json({ok:true})
})
const check = (ok,label) => { assert.ok(ok,label);console.log('PASS',label) }
try {
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5174/shelf',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__store?.getState().session.status === 'user')
  await page.evaluate(({bookId,citation}) => {
    const text = citation.snippet + '其余正文。'.repeat(50)
    const current = {meta:{id:bookId,title:'Token 经济 · Markdown test',author:'Test',language:'zh',addedAt:Date.now()},parsed:{meta:{title:'Token 经济',author:'Test',language:'zh'},chapters:[{index:0,title:'成本结构',href:'chapter.xhtml',textLength:text.length,blocks:[{kind:'p',text,start:0,runs:[{text}]}]}],toc:[],getImage:async()=>null}}
    window.__store.setState({current,loading:null,showLogin:false})
    window.__store.getState().openAsk()
  }, {bookId,citation})
  // ReaderWorkspace loads lazily after opening a book.
  await page.waitForFunction(() => !!window.__reader)
  await page.evaluate(() => { window.__reader.revealLocator = locator => { window.__navigated = locator } })
  await page.waitForSelector('.answer-markdown table')
  check(await page.$$eval('.answer-markdown', els => els.every(el => !el.textContent.includes('DSML'))), 'saved protocol markup is not shown as an answer')
  check(await page.$$eval('.answer-markdown [role=status]', els => els.some(el => el.textContent.includes('interrupted'))), 'old broken answers explain that the response was interrupted')
  check(await page.$eval('.answer-markdown h1',e=>e.textContent==='大模型推理的成本结构'), 'Markdown headings render without literal hashes')
  check(await page.$eval('.answer-table',e=>e.querySelectorAll('tbody tr').length===2), 'Chinese cost table renders with two real rows')
  check(await page.$eval('.answer-table th:last-child',e=>getComputedStyle(e).textAlign==='right'), 'GFM column alignment is preserved')
  check(await page.$$eval('.answer-markdown input[type=checkbox]',els=>els.length===2&&els.every(e=>e.disabled)&&els[0].checked&&!els[1].checked), 'task list checkbox states render read-only')
  check(!!await page.$('.answer-markdown ol ul') && !!await page.$('.answer-markdown blockquote blockquote'), 'nested lists and quotations render structurally')
  check(!!await page.$('.answer-markdown strong em') && !!await page.$('.answer-markdown del'), 'nested emphasis and strikethrough render')
  check(await page.$$eval('.answer-markdown strong', els => els.some(el => el.textContent === '“联队”是核心战术单位')), 'saved Chinese emphasis next to quotation marks renders without literal asterisks')
  check(!!await page.$('.answer-markdown .katex-display math'), 'display math renders through KaTeX')
  check(!!await page.$('.answer-code .hljs-keyword'), 'fenced code has syntax highlighting')
  check(await page.$$eval('.answer-citation',els=>els.length===3), 'book and web references render without turning unsafe sources into links')
  check(await page.$eval('.answer-citation a[href="https://example.com/research"]',e=>e.target==='_blank'&&e.rel.includes('noopener')&&e.textContent==='3'), 'external citation opens the source in a separate tab')
  check(await page.$$eval('.cites a',els=>els.length===1&&els[0].href==='https://example.com/research'&&els[0].textContent.includes('Web')), 'restored external sources are labeled separately from book passages')
  await page.$eval('.answer-code button',e=>e.click())
  check((await page.evaluate(()=>window.__copied)).includes('const value = "[2]"'), 'copy code preserves raw content')
  check(await page.$eval('a[href="https://example.com"]',e=>e.target==='_blank'&&e.rel.includes('noopener')), 'external Markdown links keep reader tab and isolate opener')
  check(await page.evaluate(()=>!window.__unsafe&&!document.querySelector('.answer-markdown script')&&!document.querySelector('.answer-markdown [onerror]')&&!document.querySelector('.answer-markdown a[href^="javascript:"]')), 'active HTML and unsafe links are removed')
  const before = page.url()
  await page.$eval('.answer-markdown a[data-footnote-ref]',e=>e.click())
  check(page.url()===before && !!await page.$('.ask'), 'footnotes scroll inside chat without triggering book navigation')
  check(await page.$$eval('.answer-markdown [id]',els=>new Set(els.map(e=>e.id)).size===els.length), 'different messages have unique footnote IDs')
  await page.waitForFunction(()=>document.querySelector('.answer-diagram img')?.naturalWidth>0)
  check(!!await page.$('.answer-diagram img[src^="data:image/svg+xml"]'), 'Mermaid renders as an inert SVG image')
  await page.waitForFunction(()=>[...document.querySelectorAll('.answer-diagram-status')].some(e=>e.textContent.includes('could not be rendered')))
  check(!!await page.$('.answer-diagram details[open]'), 'invalid diagrams retain readable source instead of breaking chat')
  check(await page.$eval('#reader-agent-title',e=>e.textContent==='Infinite') && await page.$eval('.agent-launcher',e=>e.textContent.includes('Infinite')), 'window and launcher are named Infinite')
  const dimensions = () => page.$eval('.ask',async e=>{
    await Promise.all(e.getAnimations().map(animation=>animation.finished.catch(()=>{})))
    const r=e.getBoundingClientRect();return {width:r.width,height:r.height,area:r.width*r.height/(innerWidth*innerHeight)}
  })
  const compact = await dimensions()
  await page.type('.ask-composer textarea','Keep this draft while resizing')
  const originalMessages = await page.$$eval('.msg',els=>els.map(e=>e.textContent))
  await page.click('[aria-label="Expand Infinite"]')
  const expanded = await dimensions()
  check(expanded.area>.45 && expanded.area<.55 && expanded.width>compact.width && expanded.height>compact.height, 'expanded desktop window occupies roughly half of the viewport')
  check(await page.$eval('.ask-composer textarea',e=>e.value==='Keep this draft while resizing'), 'resize preserves the unsent draft')
  check(JSON.stringify(await page.$$eval('.msg',els=>els.map(e=>e.textContent)))===JSON.stringify(originalMessages), 'resize preserves rendered conversation')
  await fs.mkdir('/tmp/agent-markdown-screenshots',{recursive:true})
  await page.$eval('.ask .thread',e=>e.scrollTop=0)
  await page.screenshot({path:'/tmp/agent-markdown-screenshots/expanded-desktop.png'})
  // The same focused control restores via keyboard as well as mouse.
  await page.keyboard.press('Enter')
  const restored = await dimensions()
  check(restored.width===compact.width && restored.height===compact.height, 'restore returns to the exact original size using keyboard activation')
  await page.click('[aria-label="Close Infinite window"]')
  await page.waitForSelector('.ask',{hidden:true})
  await page.click('.agent-launcher')
  await page.waitForSelector('.ask')
  check(await page.$eval('.ask-composer textarea',e=>e.value==='Keep this draft while resizing'), 'close hides the window and reopening retains the draft')
  await page.click('[aria-label="Expand Infinite"]')
  await page.click('[aria-label="Close Infinite window"]')
  await page.waitForSelector('.ask',{hidden:true})
  await page.click('.agent-launcher')
  await page.waitForSelector('.ask.is-expanded')
  check(true, 'closing an expanded window still closes it; reopening keeps the size preference')
  await page.click('[aria-label="Restore Infinite size"]')
  await page.focus('.ask-composer textarea')
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace')
  await page.$eval('.ask .thread',e=>e.scrollTop=0)
  await fs.mkdir('/tmp/agent-markdown-screenshots',{recursive:true})
  await page.screenshot({path:'/tmp/agent-markdown-screenshots/desktop.png'})
  await page.setViewport({width:390,height:844})
  await page.screenshot({path:'/tmp/agent-markdown-screenshots/mobile.png'})
  check(await page.$eval('.ask',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}), 'Agent fits mobile viewport')
  check(await page.$eval('.ask .thread',e=>e.scrollWidth<=e.clientWidth+1), 'wide content does not stretch conversation horizontally')
  check(await page.$$eval('.answer-table',els=>els.some(e=>e.scrollWidth>e.clientWidth)), 'wide table scrolls independently on mobile')
  check(await page.$eval('.answer-code pre',e=>e.scrollWidth>e.clientWidth), 'long code lines scroll independently')
  const mobileCompact = await dimensions()
  await page.click('[aria-label="Expand Infinite"]')
  check((await dimensions()).height>mobileCompact.height, 'phone expansion increases usable height')
  check(await page.$eval('.ask',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}), 'expanded mobile window stays within viewport')
  check(await page.$eval('[aria-label="Close Infinite window"]',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth&&[[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4]].every(([x,y])=>e.contains(document.elementFromPoint(x,y)))}), 'close stays reachable and unobscured when expanded on mobile')
  await page.$eval('.ask .thread',e=>e.scrollTop=0)
  await page.screenshot({path:'/tmp/agent-markdown-screenshots/expanded-mobile.png'})
  await page.click('[aria-label="Restore Infinite size"]')
  await page.waitForSelector('.ask:not(.is-expanded)')
  check((await dimensions()).height===mobileCompact.height, 'mobile restore returns to original height')

  await page.$eval('.answer-citation a',e=>e.click())
  await page.waitForSelector('.ask',{hidden:true})
  check((await page.evaluate(()=>window.__navigated))?.chapter===0, 'book citation still reveals its source passage and collapses chat')
  await page.click('.agent-launcher')
  await page.waitForSelector('.ask-composer textarea')
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input,init) => {
      if (String(input) !== '/api/ask') return realFetch(input,init)
      window.__streamRequests = (window.__streamRequests || 0) + 1
      const text = '# Streamed heading\n\n也可以看出**“联队”是核心战术单位**（约相当于团）。\n\n| A | B |\n|---|---|\n| **Value** | 42 |\n\n```js\nconst done = true;\n```'
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({async start(controller) {
        for (let i=0;i<text.length;i+=4) {
          controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'delta',text:text.slice(i,i+4)})+'\n\n'))
          await new Promise(resolve=>setTimeout(resolve,50))
        }
        controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'done'})+'\n\n'));controller.close()
      }}),{headers:{'content-type':'text/event-stream'}})
    }
  })
  await page.type('.ask-composer textarea','Test streamed Markdown')
  await page.click('.ask-composer button[type=submit]')
  await page.waitForSelector('.ask .caret')
  await page.click('[aria-label="Expand Infinite"]')
  await page.click('[aria-label="Close Infinite window"]')
  await page.waitForSelector('.ask',{hidden:true})
  await page.click('.agent-launcher')
  await page.waitForSelector('.ask')
  await page.waitForSelector('.ask .caret',{hidden:true})
  check(await page.evaluate(()=>window.__streamRequests===1), 'resize and close/reopen do not restart the streamed request')
  check(await page.$eval('.msg.ai:last-child h1',e=>e.textContent==='Streamed heading'), 'streamed partial Markdown settles into a heading')
  check(await page.$eval('.msg.ai:last-child td',e=>e.textContent==='Value'), 'streamed partial Markdown settles into a table')
  check(await page.$$eval('.msg.ai:last-child strong', els => els.some(el => el.textContent === '“联队”是核心战术单位')), 'streamed Chinese emphasis settles into bold text')
  check(errors.length===0,`no browser errors: ${errors.join('; ')}`)
} finally { await browser.close() }
