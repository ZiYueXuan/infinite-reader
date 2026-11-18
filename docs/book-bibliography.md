# 书籍出版元数据提取与保存

实现日期：2026-10-30。目标是建立后续书目匹配的数据基础，本阶段不查询豆瓣、不生成评分、不使用模型推断出版信息。

## 数据与来源

共享类型：`shared/bibliography.ts`。D1 增量迁移：`0006_book_bibliography.sql`，在 books 上增加 bibliography JSON、bibliography_attempted_at、bibliography_error。

从 EPUB 的 OPF 中读取：

- 多个标题与 EPUB 3 title-type（例如 main/subtitle）；
- 全部作者/贡献者、角色、排序名：兼容 EPUB 2 opf:role/file-as 和 EPUB 3 meta refines；creator 无角色时按作者 aut，contributor 无角色时保留未知，不猜译者；
- 出版社、出版/创建/修改日期及其类型、语言、简介、主题、权利声明；
- 明确声明的版次（prism:edition / biblio:edition / edition）；
- 全部 identifier/source、主标识、scheme 及 EPUB 3 identifier-type；
- 有界的原始 OPF 值和属性，包括当前不解释的扩展字段，如丛书、卷次、原作名的自定义字段。

每个值保存 kind/path/field/index 来源。OPF 的 index 是同字段下的序号；版权页 index 是已解析章节纯文本中的匹配位置。原文、章节文字与定位偏移不变。

ISBN-10/13 校验校验位；有效 ISBN-10 规范化为 ISBN-13。支持 urn:isbn、ISBN 标签、空格/连字符及全角数字。无效 ISBN 保留原值并标 invalid_isbn；UUID、其他已声明类型的数字 ID 不强制转成 ISBN。多个号码不合并，保留 publication / source / unknown 关系；source 只表示来源出版物，不能据此直接声称是纸质版。

补充扫描明确标为“版权信息/版权页/出版说明/图书在版编目/Copyright”的章节或章节开头，且需要出版或权利相关文字佐证。只提取带 ISBN 标签的号码和带冒号的书名、出版社、作者、译者、出版日期、版次；保留为独立的版权页候选，不覆盖 OPF 值。不会扫描普通正文或参考文献后取第一个 ISBN。

限制：没有 OCR，不从封面猜信息；无标识的版权页、图片版权页、无标签的复杂 CIP 排版可能无法提取。不拆分含多个姓名的版权页字段，不凭年份推断出版日期；未解释扩展字段保留在 raw。缺失字段是空数组，而不是补造内容。

资源上限：OPF 最多 256 个字段、每值 4096 字符、最多 16 个有界属性，并有约 64K 字符预算；超限保留 warnings。版权页扫描最多 8 个候选章节，每章前 12K 字符，版权页 ISBN 提取受总量保护。不存整章/整本原文进 metadata。

## 生命周期

新书：上传 → 现有 parse 任务 → 连同书籍信息写入 bibliography → 现有索引流程。元数据处理本身没有外部请求/AI token。

旧书：下次从服务端读取原文件时，若 ready 且 bibliography 为空，则后台补提取。独立 metadata 任务只读取 R2 原文件、解析文本并写新字段；不写 display title/author、chunks、embedding、progress、state、notes、annotations 或 updated_at。阅读状态与任务错误隔离，五分钟内重复请求只发送一次任务；队列失败仍沿用有限次退避重试，耗尽也不会把书籍改为 failed。

已经保存的记录不会在每次打开时重提取。文件仍在浏览器缓存中、没有请求服务端时，旧书可能暂未补齐；可以通过 owner-only POST metadata 主动触发。没有对整个生产书库执行批量回填。

API：GET /api/books/:id 返回 bibliography；GET /api/books/:id/metadata 返回提取状态与数据；POST 同路径对缺少数据的 ready 书籍调度补提取。其他用户得到 404。书架列表不携带完整 raw 元数据；详情通过下文的「书籍信息」入口按需读取。本地离线存储模式保持不变。

并发与删除：任务开始和更新时检查书籍仍存在、ready 且未提取；已删除书籍不会因旧任务恢复。清除 books 记录会一并删除元数据。bibliography 保留文件来源信息，与用户重命名相互独立；书架现有作者显示方式保持原样，完整作者列表供后续匹配使用。

## 费用和验证

新书解析费用仍归现有“后台解析书籍”；旧书单独记“提取书籍出版信息”，包含 D1 读写和 R2 读取。无新的模型调用，不重建 embedding。元数据 API 的请求费用单独标记为读取/补提取出版信息。

回归测试覆盖 ISBN 校验、EPUB 2/3 角色与 refinements、出版日期与文件修改日期区分、多标识和无效号码保留、元数据限制、版权页/参考文献区分、章节与目录不变、持久化与所有权、缓存复用、旧书回填、费用记录、并发去重、失败状态隔离和删除后的旧任务。

部署先应用增量迁移，再发布 Worker；旧 Worker 不依赖新列，可在迁移后继续运行。

## 书架查看入口

书架每本书的「⋯」菜单新增「书籍信息」。弹窗展示已保存的书名、作者、译者、出版社、版次、语言、各类日期、ISBN/其他标识、简介、主题、权利声明以及文件名/大小。字段附文件元数据/版权页来源标签；ISBN 分别展示规范值、原值、校验结果和版本关系。缺失值显示“未提供”，文件修改日期不会冒充出版日期。完整提取来源和原始记录可按需展开。

打开弹窗只读取已保存的数据；旧书尚未提取时可点击“提取出版信息”，发送一次 POST 后进行有界的状态查询，关闭弹窗取消查询，切换账号/删除书籍会卸载弹窗。失败可重新读取或在后端五分钟间隔后重试提取。不会自动重复 POST，也不会调用 AI。本地书籍显示已有基础信息，不访问云端 metadata API。

浏览器回归：`web/scripts/check-book-info.mjs`（VITE_BACKEND=api，接口全部使用 fixture），验证菜单键盘操作、Escape 焦点恢复、出版字段/日期/来源、文本安全渲染、一次提取与只读轮询、关闭取消轮询、错误恢复、重试间隔、窄屏尺寸和账号退出清理。
