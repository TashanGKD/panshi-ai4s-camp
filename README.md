# 磐石 AI4S 实训营站点

这是一个面向单次 AI4S 实训营的独立 npm workspaces 项目，采用模块化单体结构。当前任务只建立工作区和质量门禁，不包含业务实现。

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

应用源码会在后续任务中加入，因此本次脚手架阶段只验证工作区结构与质量命令。

## 质量命令

```bash
node tests/workspaces.test.mjs
npm run typecheck
npm run lint
```

需要运行各工作区后续提供的完整检查时，可使用：

```bash
npm run build
npm test
```

环境变量从 `.env.example` 复制后按本机环境填写；示例文件不保存真实凭据。
