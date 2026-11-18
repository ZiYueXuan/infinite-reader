# 书中地图 → 地球视图：首版

日期：2026-10-24。

## 范围

支持《命运攸关的抉择》原始 EPUB 中的两张地图：西欧（1940）和巴尔干地区（1940—1941）。按原始 JPEG 的 SHA-256 精确识别，图片路径和重排页码不参与身份判断。其他插图保持原来的阅读行为。本版未调用视觉模型，也不宣称通用地图识别、历史边界重建或原图地理配准。

- 点击左右页的地图图片或“在地球中查看”，在阅读器内打开地图。
- MapLibre 球面地球过渡到对应区域，提供全球、区域与 3D 地形视角。
- 原图并排展示，可放大；15 个经过核实的城市位置可点击，原图同步标出城市符号。
- 关闭或按 Esc 返回原页，书籍缩放、视角和位置不随地图操作改变。
- 拖动书页、平移、划线和翻页期间不打开地图；模态视图隔离后台阅读器输入。
- 地图模块与 Worker 按需加载，关闭时销毁 MapLibre 实例，打开期间暂停书籍场景绘制。
- WebGL/模块失败可重试；远程地形失败时仍显示本地基础底图和原图。

## 实现与数据

`atlas/catalog.ts` 只保存经核实的地图身份、范围、城市坐标和原图锚点；`book/loader.ts` 复用原图读取；`engine/scene.ts` 通过实际纸张网格 UV 命中图片；`ui/AtlasDialog.tsx` 管理原图和模态生命周期；按需加载的 `AtlasMap.tsx` 负责地图渲染。没有新增后端接口、数据库表或 Secrets。

这将图片身份、书籍交互与地图生命周期分开，避免按页码硬编码，也不为后续 AI 流程预建无用结构。

MapLibre 固定为 6.15.0；参考项目的 5.24.0 在依赖审计中命中 GHSA-jrc7-96c5-q579，因此未采用。按官方 v6/Vite 方式打包独立 Worker：`?worker&url`，通过 `setWorkerUrl` 指定。

地图使用自然地形，不绘制现代政治国界。全局基础瓦片复用参考项目的 z0–3，共 85 张，约 324 KB；高细节地形使用公共 Mapzen Terrarium 数据。城市坐标来自 Natural Earth。原书图片只在当前浏览器从自己的 EPUB 读取，不包含在公开部署资源中。数据出处见 `web/public/atlas/README.md`。

官方参考：

- https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/
- https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- https://www.naturalearthdata.com/about/terms-of-use/

## 验收记录

- 真实 EPUB：共 1326 个重排页面，两个原图分别位于索引 7、8；准确识别两个 SHA-256。
- 内置浏览器：左右页直接点击、按钮入口、城市联动、全球/区域视角、关闭资源清理已验证。
- 书籍拖动不会误打开地图；Esc 关闭后页码、视角、缩放与位置保持；地图 Cmd + 加号未改变浏览器及书籍缩放。
- 窄屏 CSS 视口 354 × 767：地图在上、原图及可滚动地点列表在下，模态容器没有横向溢出。
- 阻断远程高程瓦片后，区域基础底图仍可使用，并提示部分细节不可用；恢复网络后正常加载。
- 自动测试：地图身份拒绝同体积伪图、目录数据范围检查，以及已有翻页、便笺对齐、路由回归，共 11 项通过。
- TypeScript 与 Vite 构建通过；新增代码无 lint 告警；仓库原有 4 项告警保留。

生产版本：`worker-version-id`。线上 HTML、主包 `index-CPowT9Sd.js`、地图包 `AtlasMap-klR8Z0-H.js`、独立地图 Worker 和基础瓦片均返回 200，SHA-256 与本地构建一致。验证在 Codex 内置浏览器完成；实际 EPUB 使用浏览器本地副本，未新增云端书籍或修改云端笔记。首页没有提前请求地图包和地图 Worker。

生产交互复验：右页点击打开巴尔干区域，索非亚的原图锚点与地球标记同步选中，地形开关正常；关闭后仍为第 4 个翻页位置，地图 Canvas 数为 0，焦点返回地图入口，阅读输入解除暂停。左侧西欧入口也正常。区域加载未产生运行错误。

## 后续地图识别

DeepSeek 官方在本次实现时确认 `deepseek-flash` 对应 DeepSeek-V4.1-Flash-1017，并支持图片输入。下一版可让模型提取图名、年代、地名和图内位置，再经地名库消歧核验坐标。原图配准和历史疆域仍需独立验证。本版未调整已有问答模型、未调用识别 API。

- https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
- https://api-docs.deepseek.com/zh-cn/guides/vision/
