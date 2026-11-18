# EPUB 引文与文学排版调研

日期：2026-10-26。范围：源文件与现有代码调查、开源方案对比；没有修改生产渲染逻辑。

## 结论

推荐保留 EPUB XHTML/CSS 的结构，扩展现有 Block 排版模型，借鉴 Tufte CSS 的章首题辞样式与 Tailwind Typography 的层级/间距规则。Doocs MD 可参考中文主题与主题配置。无需先把整本书转换成 Markdown，也不需要用大模型识别引文。

## 截图对应源文件证据

检查本地文件：
/path/to/Library/Mobile Documents/com~apple~CloudDocs/eBook/2026/波斯之剑-纳迪尔沙与现代伊朗的崛起/波斯之剑纳迪尔沙与现代伊朗的崛起 ([英] 迈克尔·阿克斯沃西(Michael Axworthy)) (z-library.sk, 1lib.sk, z-lib.sk).epub

成员 index-1_split_010.html 中，h1 标题“1 萨法维王朝的衰落”后：
- 十二个 p.calibre2 对应截图中的诗行；
- 第十三个 p.calibre2 是“——马洛”；
- 后续长篇正文也使用 p.calibre2。
- 没有 blockquote、cite、epub:type=epigraph 或独立的诗歌容器。
- stylesheet.css 的 .calibre2 只有 display:block 与 margin:1em 0。

这份本地 EPUB 的文字/结构与截图吻合；没有对云端 EPUB 做二进制一致性比对。不能声称原书给此段提供了专门的语义标记，也不能用 calibre2 这个类名全书识别引文。

## EPUB 可以表达哪些结构

EPUB 3 结构语义词汇定义 epigraph（作品/章节开头的题辞），可通过 epub:type 表达，并对应 doc-epigraph ARIA role。普通 XHTML 还可使用 blockquote、q、cite、footer、br 等。出版商可能使用自定义 class 与 CSS，也可能像本书一样把信息全部扁平化。

标准：https://www.w3.org/TR/epub-ssv-11/#epigraph

## 当前代码中的限制

- web/src/book/epub.ts: CssProps 仅保留 align、italic、bold、smallcaps、noIndent；无法保留原书的字号比例、段落间距、左右缩进。
- parseCss 只匹配简单 tag/.class/tag.class 选择器，不能当作完整 CSS 级联。
- walk 只把 blockquote 设为 quote；不识别 epub:type/role 的题辞语义，不保存引文组或署名角色。
- br 调用 pushText 的换行在非 pre 情况被空白归一化折叠；layout tokenize 也将空白作为词间距处理。此缺陷与截图的独立 p 诗行是两个不同问题。
- web/src/book/types.ts 已有 quote，但没有 epigraph/verse/attribution 角色或组信息。
- web/src/book/layout.ts 的 quote 只做 0.96 倍字号、左右缩进与少量间距；普通中文 p 默认首行缩进两个字。
- web/src/book/pageRender.ts 通过 Canvas fillText 绘制，再用于书页贴图；网页 CSS 库无法直接改变已绘制的文本。

## 开源项目对比

以下许可证均查阅了仓库 LICENSE 正文，非仅凭 GitHub 标签。MIT 使用需保留适用版权与许可声明；第三方字体、图片、主题和依赖仍按其各自许可处理。

| 项目 | 主许可证 | 可借鉴内容 | 对本项目的适配判断 |
| --- | --- | --- | --- |
| Tufte CSS | MIT | 专门的 epigraph、轻量 blockquote、右对齐小字号署名、留白 | 文学书页首选视觉参考；不是 Markdown 解析器，不照搬西文斜体/宽侧栏 |
| Tailwind CSS Typography | MIT | HTML 正文元素的字号/间距体系、引用与图注、可配置主题 | 借鉴设计参数，映射到 Canvas；不需要仅为它引入 Tailwind |
| Doocs MD | WTFPL v2 | 中文排版、主题配置、Markdown 转适合微信公众号的 HTML | 中文主题参考；其 @md/core 已可拆分，但输出 HTML 不会解决我们的 Canvas 分页 |
| Vditor | MIT | Markdown 预览、脚注/表格/公式/中文选项 | 功能全面，若以后编辑笔记有价值；不作为当前 3D 书页的直接替代 |
| github-markdown-css | MIT | 简洁一致的 GitHub 风格、基础引用/列表/表格 | 技术内容参考；文学题辞更适合采用 Tufte 风格 |

仓库与许可证：
- https://github.com/edwardtufte/tufte-css
- https://github.com/edwardtufte/tufte-css/blob/gh-pages/LICENSE
- https://github.com/edwardtufte/tufte-css/blob/gh-pages/tufte.css
- https://edwardtufte.github.io/tufte-css/
- https://github.com/tailwindlabs/tailwindcss-typography
- https://github.com/tailwindlabs/tailwindcss-typography/blob/main/LICENSE
- https://github.com/doocs/md
- https://github.com/doocs/md/blob/main/LICENSE
- https://github.com/doocs/md/blob/main/packages/core/README.md
- https://github.com/Vanessa219/vditor
- https://github.com/Vanessa219/vditor/blob/master/LICENSE
- https://github.com/sindresorhus/github-markdown-css
- https://github.com/sindresorhus/github-markdown-css/blob/main/license

## 建议的实现边界

EPUB XHTML/CSS → 保留原始定位信息的 Block + 语义元数据 → 统一排版规则 → 现有分页/Canvas/3D 渲染。

识别顺序：
1. 明确的 epub:type、role、blockquote 等语义优先；
2. 已支持 CSS 的组合特征作为辅助，不把任意出版商类名当作标准；
3. 仅对章首连续短段落、明确短署名、随后正文等多重证据一致的情况推断题辞。不能只凭“短段落”或“——”判断；对白、清单、目录应作为反例；
4. 不确定时维持普通正文。无大模型调用。

视觉方向：
- 题辞整体内收，诗行左对齐、取消逐行首行缩进，保留行/节边界。
- 中文保持正体，可评估合规可用的楷体，不默认伪斜体；字号约正文 92%—96%，墨色略柔和但保持可读性。
- 署名约正文 82%—86%，在题辞区域右对齐，与诗句保留适当距离。
- 题辞前后留白，和后文明确分隔；题辞不用彩色卡片或粗边框。
- 普通块引用可以使用细淡竖线或缩进；与章首诗歌区别呈现。
- 分页尽量将署名与末两行留在同页；长题辞可以分页，不能整组强制同页造成溢出。

兼容与验收：
- 第一版以新增排版元数据为主，不重写原始 runs/text/start，不合并导致偏移变化的段落。
- br 修复需独立处理软硬换行与文字 offset，检查前后端纯文本归一化一致性。
- 验证旧划线、便笺、目录锚点和 AI 引用仍能定位；单页与跨页题辞、长英文行、窄屏、缩放均需覆盖。
- 不触发重新 Embedding；视觉格式化不应导致原始内容重新索引。
- 首批只做 blockquote、epigraph、verse、署名、显式换行；表格/脚注等后续分批处理。

本轮未安装依赖、未变更书籍数据、未部署，也未调用产品的大模型服务。

## 2026-10-26 实现与验证

上面的“本轮”指调研阶段。经用户确认，本次已实现 EPUB 语义元数据与文学排版：

- 保留 blockquote / epub:type epigraph / verse / stanza 等语义；对实际书籍中无标记的章首短诗，使用连续短段落、短署名和后续正文共同判断。
- 题辞内收、取消首行缩进与强制两端对齐，字号略收，署名右对齐；保留 br 视觉换行，同时不改变原始文本偏移。分页尽量保留署名与最后两行。
- 《波斯之剑》22 个章节与旧解析器逐字段比较，原文、runs、start 和目录标识完全一致（仅排除新增的文学元数据）。标准与紧凑页型共 5404 项浏览器断言通过。
- 新增 5 个阅读字体选项，设置在书架与阅读页的外观菜单中，在本浏览器保存。经典书刊使用现有 EB Garamond，中文使用系统宋体；其他为 Noto Serif SC、Noto Sans SC、LXGW WenKai、ZCOOL XiaoWei。
- Fontsource 固定版本：Noto 两款 5.3.1、WenKai 5.3.0（500 字重）、XiaoWei 5.3.0。完整 OFL 许可随静态资源发布于 `/fonts/licenses.html` 及同目录文本文件。不依赖外部字体 CDN。
- 仅下载所选字体、所需 Unicode 子集；主线程测量与 Worker 贴图使用同一字体元数据。切换后按原文锚点重排，保留相机，下载失败保留旧排版，30 秒超时可重试。
- 本地浏览器验证五种字体可切换、刷新后设置保留、正文锚点保持、模拟字体加载失败后继续阅读。7 项 Node 测试通过；前端构建通过。未调用 AI 或重新生成 Embedding。

复验入口：`web/scripts/typography-check.html` 与 `web/scripts/reading-typeface-check.html`；后者使用合成 EPUB，拦截 API，不写生产数据。

发布验证：Cloudflare Worker 版本 `worker-version-id`，前端入口 `index-BocSe9fN.js`。线上入口与本地构建一致，许可页内容一致；内置浏览器在真实《波斯之剑》上加载文楷，检查第一章诗歌与署名，并恢复经典字体。Lint 通过，保留 3 条既有警告。
