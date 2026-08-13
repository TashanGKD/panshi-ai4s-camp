# 磐石 AI4S 实训营站点

这是一个面向单次 AI4S 实训营的独立 npm workspaces 项目，采用模块化单体结构。共享 contracts、PostgreSQL 数据库与迁移基础、API 服务基础和公开站点首页壳层已经实现。当前公开内容仍是隔离 fixture；内容发布 API、后台页面以及注册、账户等业务路由属于后续任务。

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

API 数据层使用 PostgreSQL 16、Drizzle 类型映射和受版本控制的 SQL 迁移。迁移不会随服务启动自动执行。

## PostgreSQL 与迁移

本地开发可启动 Compose 中唯一的 PostgreSQL 服务。下面的 Compose 命令是标准工作流，但本次验证环境缺少 Docker Compose 插件且 Docker daemon 未运行，因此没有实际执行：

```bash
docker compose up -d postgres
```

Compose 仅把容器的 5432 端口绑定到主机回环地址 `127.0.0.1:5433`，并使用项目专属具名卷 `panshi-postgres-data`。首次运行数据库集成测试前，在 Compose 服务内显式创建专用测试库：

```bash
docker compose exec postgres createdb --username panshi --owner panshi panshi_ai4s_camp_test
```

迁移与测试命令必须显式提供目标 URL：

```bash
DATABASE_URL='postgresql://panshi:panshi_local@127.0.0.1:5433/panshi_ai4s_camp' \
  npm run db:migrate -w @panshi/api

TEST_DATABASE_URL='postgresql://panshi:panshi_local@127.0.0.1:5433/panshi_ai4s_camp_test' \
  npm test -w @panshi/api -- schema.test.ts
```

上述账号和密码是与 `compose.yaml` 对齐的本地开发占位值，绝不能用于生产环境。迁移按文件名顺序执行，已应用文件由数据库内的 `panshi_schema_migrations` 记录；重复执行安全，已应用迁移被修改时会拒绝继续。

数据库集成测试必须显式提供 `TEST_DATABASE_URL`，且数据库名必须恰好为 `panshi_ai4s_camp_test`；测试不会回退到 `DATABASE_URL`。测试清理会截断领域表，因此禁止指向开发库或任何名称相近但不完全相同的数据库。

`audit_logs.actor_user_id` 使用 `ON DELETE RESTRICT` 保留不可变的审计归属。用户停用应更新 `users.disabled_at`，而不是删除用户记录。

Task 3 的本次验证使用本机 PostgreSQL 16.14 和专用数据库 `panshi_ai4s_camp_test`。`compose.yaml` 仅完成静态 YAML 校验；由于当前环境没有 Docker Compose 插件且 Docker daemon 未运行，没有执行或声称容器端到端验证。该记录只描述本次验证环境，不表示其他开发者本机已经存在同名数据库。

## 质量命令

```bash
node tests/workspaces.test.mjs
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

`npm test` 会先运行根目录结构测试，再逐一运行五个 workspace 的 Vitest。API schema 集成测试必须按上文显式提供专用测试数据库；`typecheck` 和 `build` 会逐一检查各 workspace。

公开站点的 Playwright 视觉测试使用本机已安装的 Chromium，并按操作系统保存快照：

```bash
npm run visual:test
npm run visual:update
```

`visual:test` 只比较当前平台已有的基线，不会改写图片；`visual:update` 才生成或更新当前平台基线。快照文件名包含 Playwright 的 `{platform}` 值（例如 `darwin` 或 `linux`），因此 macOS 与 Linux CI 各自维护对应基线。首次在新平台运行时，应在固定 Node、Playwright/Chromium、字体和视口环境中执行 `visual:update`，人工检查生成图片后再提交。测试中的 source-vs-migrated 直接 PNG 对比始终要求零个 RGBA 通道差异，但该比较只在同一次运行、同一渲染环境内成立，不跨操作系统复用像素结果。

环境变量从 `.env.example` 复制后按本机环境填写；示例文件不保存真实凭据。
