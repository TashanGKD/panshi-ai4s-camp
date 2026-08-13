# 磐石 AI4S 实训营站点

这是一个面向单次 AI4S 实训营的独立 npm workspaces 项目，采用模块化单体结构。共享 contracts 与 PostgreSQL 数据库基础已经实现，web/admin 页面和 API 路由仍属于后续任务。

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

本地开发可启动 Compose 中唯一的 PostgreSQL 服务：

```bash
docker compose up -d postgres
DATABASE_URL="$DATABASE_URL" npm run db:migrate -w @panshi/api
```

运行迁移前必须显式设置 `DATABASE_URL`。Compose 将容器的 5432 端口映射到主机 5433，并使用项目专属具名卷 `panshi-postgres-data`；其配置值只适用于本地开发。迁移按文件名顺序执行，已应用文件由数据库内的 `panshi_schema_migrations` 记录；重复执行安全，已应用迁移被修改时会拒绝继续。

数据库集成测试必须显式提供 `TEST_DATABASE_URL`，且数据库名必须采用 `panshi_ai4s_camp_*_test` 形式。测试不会回退到 `DATABASE_URL`：

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -w @panshi/api -- schema.test.ts
```

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

环境变量从 `.env.example` 复制后按本机环境填写；示例文件不保存真实凭据。
