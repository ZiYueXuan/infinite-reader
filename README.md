<p align="center">
  <img src="./web/public/favicon.svg" width="64" height="64" alt="Infinite Reader 图标" />
</p>

<h1 align="center">Infinite Reader</h1>

<p align="center">一款适合沉浸阅读的网页 EPUB 阅读器。</p>

<p align="center">
  <a href="https://ereader.space/shelf">在线体验</a> ·
  <a href="#本地运行">本地运行</a> ·
  <a href="./worker/README.md">后端开发</a>
</p>

![Infinite Reader 中打开中文样书的仿真双页视图](./web/public/landing/reader-zh-CN.webp)

## 阅读体验

- **仿真翻页**　桌面双页和移动端单页阅读，支持调节字体、字号和主题。
- **划线与笔记**　用高亮、下划线和 Markdown 笔记记录阅读，随时回到原文。
- **AI 伴读**　围绕选中文本或全书提问，按引用回到原文。明确要求时可搜索外部资料。
- **阅读地图**　从正文和书中图片识别地点，在 3D 地图上查看位置和地形。

## 本地运行

使用 Node.js 22.12 或更新版本，在仓库根目录运行以下命令。

```bash
npm --prefix web ci
VITE_BACKEND=local npm --prefix web run dev
```

打开[本地中文样书](http://localhost:5173/?sample=zh&lang=zh-CN)，也可以在书架导入自己的 EPUB。本地模式将书籍和批注保存在浏览器中。云同步和 AI 功能需要配置 [Cloudflare Worker](./worker/README.md)。

## 项目结构

| 目录 | 职责 |
| --- | --- |
| [`web/`](./web) | React 阅读界面、Vite 构建与 Three.js 仿真书页 |
| [`worker/`](./worker) | Hono 与 Cloudflare Workers 提供的登录、云存储和 AI 服务 |
| [`shared/`](./shared) | 前后端共用的类型、校验规则和中英文文案 |

开发文档涵盖 [API](./worker/API.md)、[阅读地图](./docs/text-atlas.md)和 [AI 伴读](./docs/pi-agent-integration.md)。推送到 `main` 或向 `main` 提交 PR 时会运行 [CI 检查](./.github/workflows/ci.yml)。自建部署参考 [Worker 配置文档](./worker/README.md#deploy)。

## 许可

项目的原创源码和文档采用 [Apache-2.0](./LICENSE) 协议。第三方组件、字体和地图数据遵循各自的许可，相关署名见 [NOTICE](./NOTICE)。
