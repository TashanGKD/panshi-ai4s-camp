# 磐石 AI4S 实训营站点

这是一个面向单次 AI4S 实训营的独立 npm workspaces 项目，采用模块化单体结构。共享 API 契约、契约测试和可消费的构建产物已建立；应用 workspace 仍处于脚手架阶段，尚未实现业务接口或页面。

## 运行环境

- Node.js 24.x
- npm 11.x

## 工作区职责

- `apps/web`：学员侧公开网站。
- `apps/admin`：运营管理后台。
- `apps/api`：Express API、数据访问和服务端业务边界。
- `packages/contracts`：跨应用共享的 Zod 数据契约与类型。
- `packages/ui`：`web` 与 `admin` 共用的 React UI 组件。

## 启动命令

安装依赖后，在本目录分别启动三个应用：

```bash
npm run dev:web
npm run dev:admin
npm run dev:api
```

应用源码会在后续任务中加入；当前启动命令只保留工作区入口，不代表应用功能已经实现。

## 质量命令

```bash
node tests/workspaces.test.mjs
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

`npm test` 会先运行根目录结构测试，再逐一测试五个 workspace。`packages/contracts` 已包含契约测试，并会先构建 `dist`、再通过原生 Node 自引用验证 package export；应用 workspace 暂无应用测试，Vitest 会明确报告 `No test files found` 并通过。`typecheck` 和 `build` 会逐一调用每个 workspace 的 TypeScript 配置，其中应用 workspace 仍以 `files: []` 明示尚无源码。

环境变量从 `.env.example` 复制后按本机环境填写；示例文件不保存真实凭据。
