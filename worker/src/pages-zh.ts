const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function aboutZh(app: string) {
  return `<h1>${esc(app)}</h1>
<p class="meta">静心阅读，随手批注，与书中的思想对话。</p>
<p>${esc(app)} 是一款基于无限画布的网页 EPUB 阅读器。上传你自己的 EPUB 书籍，体验翻页阅读、划线和下划线，在画布中添加便笺，并向 AI 阅读伙伴询问选中段落或整本书。回答会引用相应的书籍原文。</p>
<div class="card"><strong>登录方式</strong><p>你可以通过邮箱一次性验证码或 Google 账号登录。我们仅使用 Google 提供的已验证邮箱、姓名和头像来创建及识别账号，不会读取 Gmail、Google Drive 或任何其他 Google 数据。</p></div>
<p><a class="btn" href="/shelf">打开阅读器</a></p>
<p>了解数据处理方式，请阅读<a href="/privacy?lang=zh-CN">隐私政策</a>和<a href="/terms?lang=zh-CN">使用条款</a>。</p>`;
}
export function privacyZh(app: string, contact: string) {
  return `<h1>隐私政策</h1><p class="meta">最后更新：2026 年 10 月 30 日</p>
<p>本政策说明你使用 ${esc(app)}（“本服务”“我们”）时，我们收集什么信息、为什么收集，以及你有哪些选择。我们收集的数据有限，因此力求简明。</p>
<h2>我们收集的信息</h2><ul>
<li><strong>账号信息。</strong>你的邮箱地址，以及使用 Google 登录时由 Google 提供的姓名和头像。我们不会获得你的 Google 密码，仅请求 <code>openid</code>、<code>email</code> 和 <code>profile</code> 权限。</li>
<li><strong>你的内容。</strong>你上传的电子书及其他受支持文件、为搜索而提取的文本，以及你创建的高亮、下划线、便笺、阅读进度、画布布局和 AI 对话记录。</li>
<li><strong>条款接受记录。</strong>你的账号 ID、明确接受的使用条款版本、接受和记录时间，以及登录方式。我们使用这些记录证明协议成立、管理账号访问并处理争议；记录随账号保存，删除账号时一并移除，法律要求保留的除外。</li>
<li><strong>用量诊断。</strong>AI token／计算用量、请求和数据库／文件操作次数、时间、账号／书籍标识及估算费用，用于帮助你查看用量和我们运营服务。这些诊断记录不额外保存书籍段落或提示词。</li>
<li><strong>技术数据。</strong>维持登录状态的会话 Cookie、为安全目的随会话保存的哈希 IP 地址和用户代理，以及基础设施供应商为运营和防滥用保留的标准请求日志。</li></ul>
<h2>我们如何使用信息</h2><ul>
<li>验证身份并维持登录状态（一次性验证码仅以加盐哈希保存，10 分钟后失效）。</li>
<li>存储和展示你的书籍与标注，并建立书籍搜索能力，供 AI 阅读伙伴查找相关段落。</li>
<li>回答你的问题。当你向 AI 阅读伙伴提问时，问题、选中的段落、附近文本和书中最相关的摘录会发送给语言模型供应商，以生成回答。</li>
<li>按你的请求识别地图。当你选择地图识别时，该插图和书名会发送给 DeepSeek，以识别区域及地名。若结果无法可靠使用，同一插图和书名会发送给 Cloudflare Workers AI 托管的 GLM-5.3 Flash 进行一次备用识别。结果为你的书籍私密缓存，删除书籍时一并移除。打开书籍或翻页时不会自动发送插图。</li>
<li>防止服务滥用（限流）并排查问题。</li></ul>
<p>我们不出售你的数据、不展示广告，也不会自行使用你的书籍或对话训练模型。</p>
<h2>谁处理你的数据</h2><ul>
<li><strong>Cloudflare</strong> 托管服务并存储数据（Workers、D1、R2、Vectorize、Queues），发送登录邮件，并通过 Workers AI 处理向量化和备用地图识别。</li>
<li>如果你选择“使用 Google 登录”，<strong>Google</strong> 负责身份验证。</li>
<li>使用 AI 阅读伙伴或地图识别时，<strong>DeepSeek</strong> 会接收上述内容，并依其条款和隐私政策处理。</li></ul>
<p>请仅上传你有权使用的书籍。书籍仅对你的账号私密可见，不与其他用户分享。</p>
<h2>Cookie</h2><p>我们使用必要的 HttpOnly 会话 Cookie（以及 Google 登录期间的短期 Cookie）。还会保存界面语言偏好，以保持页面语言一致。我们不使用广告或分析 Cookie。</p>
<h2>保留与删除</h2><p>账号存在期间会保留你的数据。在应用中删除书籍会移除该书文件、提取文本、搜索索引、标注、笔记和对话记录。登录会话会自动过期。如需删除整个账号及关联数据，请通过下方邮箱联系我们，我们会及时处理。</p>
<h2>你的权利</h2><p>你可随时要求访问、更正、导出或删除个人数据。如果你位于欧洲经济区、英国或类似司法辖区，还可能有权反对或限制处理，以及向数据保护机构投诉。</p>
<h2>儿童</h2><p>本服务不面向 13 岁以下儿童，也不会有意收集他们的数据。</p>
<h2>政策变更</h2><p>我们可能更新本政策，并相应修改上方日期。重大变更会在应用内公告。</p>
<h2>联系我们</h2><p>问题或请求：<a href="mailto:${esc(contact)}">${esc(contact)}</a>。</p>`;
}
