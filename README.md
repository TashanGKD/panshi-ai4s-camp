# 磐石 AI4S 实训营站点

这是一个面向单次 AI4S 实训营的独立 npm workspaces 项目，采用模块化单体结构。共享 contracts、PostgreSQL 数据库与迁移基础、公开内容 API 和 API 驱动的公开站点页面已经实现。后台发布页面以及注册、账户等业务路由属于后续任务。

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

安装依赖后，先在本项目根目录创建本地环境文件，再分别启动三个应用：

```bash
cp .env.example .env
npm run dev:web
npm run dev:admin
npm run dev:api
```

API 数据层使用 PostgreSQL 16、Drizzle 类型映射和受版本控制的 SQL 迁移。迁移不会随服务启动自动执行。

`npm run dev:api` 会在 `apps/api` workspace 中执行 Node 24 原生命令 `node --watch --env-file=../../.env --import tsx src/server.ts`，因此与 Web 一样加载上述项目根目录 `.env`，并保留文件变更重启。`--env-file` 只加入 API 开发命令，不改变生产构建或运行时从 `process.env` 读取并校验配置的语义。

### Web 连接 API

Web Vite 配置通过 `envDir` 显式从本项目根目录加载上述 `.env`，公开客户端从其中的 `VITE_API_BASE_URL` 读取 API 基址。未设置、空字符串或只含空白时，客户端使用当前 Web origin 下的 `/api/v1/...`；本项目当前没有配置 Vite 开发代理，因此这种模式要求同一 origin 实际能够转发或提供 API。

根目录 `.env.example` 的本地分端口默认值为 `VITE_API_BASE_URL=http://localhost:3001`，Web 默认由 Vite 在 `http://localhost:5173` 提供。配置值必须是不含凭据、query 或 fragment 的绝对 HTTP(S) URL，可含基础路径，末尾斜杠会被规范化；非法或不安全值会在客户端初始化时明确拒绝。使用已配置的 API origin 时，`fetch` 携带 `credentials: 'include'`，所以 API 的 `CORS_ORIGINS` 必须包含实际 Web origin；同源回退使用 `credentials: 'same-origin'`。

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

TEST_DATABASE_URL='postgresql://panshi:panshi_local@127.0.0.1:5433/panshi_ai4s_camp_test' \
  npm run test:integration:content -w @panshi/api
```

上述账号和密码是与 `compose.yaml` 对齐的本地开发占位值，绝不能用于生产环境。迁移按文件名顺序执行，已应用文件由数据库内的 `panshi_schema_migrations` 记录；重复执行安全，已应用迁移被修改时会拒绝继续。

数据库集成测试必须显式提供 `TEST_DATABASE_URL`，且数据库名必须恰好为 `panshi_ai4s_camp_test`；测试不会回退到 `DATABASE_URL`。测试清理会截断领域表，因此禁止指向开发库或任何名称相近但不完全相同的数据库。

`audit_logs.actor_user_id` 使用 `ON DELETE RESTRICT` 保留不可变的审计归属。用户停用应更新 `users.disabled_at`，而不是删除用户记录。

Task 3 的本次验证使用本机 PostgreSQL 16.14 和专用数据库 `panshi_ai4s_camp_test`。`compose.yaml` 仅完成静态 YAML 校验；由于当前环境没有 Docker Compose 插件且 Docker daemon 未运行，没有执行或声称容器端到端验证。该记录只描述本次验证环境，不表示其他开发者本机已经存在同名数据库。

## 初始公开内容种子

初始内容种子要求调用方显式提供数据库中已经存在的真实 `users.id` 作为创建人与审计归属；脚本不创建管理员、不读取或生成生产管理员密码：

```bash
DATABASE_URL='postgresql://...' \
CONTENT_SEED_CREATOR_USER_ID='00000000-0000-0000-0000-000000000000' \
  npm run db:seed:content -w @panshi/api
```

脚本幂等初始化八个固定模块，并发布 `basic`、`features`、`importantDates`、`schedule`、`contacts`、`display` 的版本 1。`organizations` 与 `travel` 仅建立未发布模块；`contacts` 发布为空列表。种子事务先获取项目专用的 transaction-scoped PostgreSQL advisory lock，使并发调用串行化。创建版本与把 `published_version_id` 从空值指向该版本分别记录 `content.version_created` 和 `content.version_published` 审计；复用既有版本时只要实际发生首次发布，仍会记录发布审计。重复无变化运行不重复写入版本或审计；如果既有版本 1 的 payload 不同，脚本拒绝覆盖。

内容依据文件为 `磐石·科学智能（AI for Science）实训营计划方案v2.1.1.docx`（本次读取的 SHA-256：`74a56a9a5a51c1e9fdd4b4bb3a88d0f98f493f939967a28289c3cc2b4880b13e`）。公开日期按已确认覆盖值固定为 2026-08-23 至 2026-08-27，地点为中国科学院物理研究所。源文件 OOXML 含 537 处插入和 273 处删除修订，并混有 8 月与 9 月日期残留，因此首版日程只发布五天的可核验专题层级，不复制受修订污染的逐节时间表。组织单位清单在修订中也存在增删，首版暂不发布该模块。报名截止、电话、邮箱、住宿交通、资料文件以及标为“待定”的授课人均未写入公开种子。

`相关资料` 路由复用 App 已加载并通过契约校验的 `GET /api/v1/public/site` 状态，不再二次请求；顶层请求成功后如实显示“相关资料尚未发布”，顶层网络或契约失败仍显示全站错误。当前没有实现或声称存在资料记录、资料路由或下载权限；`apps/api/src/modules/resources` 以及 public/authenticated/admitted 权限属于 Task 15。

## Task 6 验证记录（2026-08-14）

本次在本机 PostgreSQL 的专用 `panshi_ai4s_camp_test` 数据库上确认迁移共 2 个文件，并分别运行数据库测试，避免多个测试文件并行清空同一测试库。验证结果：contracts 33 项、API health 46 项、API schema 19 项、API public content 7 项、Web 14 项全部通过；admin 与 UI workspace 当前没有测试文件，`--passWithNoTests` 返回成功。根目录 `typecheck`、`lint`、`build`、workspace 结构检查和 `git diff --check` 均通过。Web 生产构建输出约 310.60 kB JavaScript（gzip 95.19 kB）。本次没有运行浏览器视觉回归或 Docker Compose 端到端验证，因此不声称这两层已验证。

Task 6 规格复核修正后，针对 API 基址解析与 `相关资料` 页面状态新增测试。本次实际验证结果为：contracts 33 项、API health 46 项、API public content 7 项、Web 27 项全部通过；根目录 `typecheck`、`lint`、`build`、workspace 结构检查和 `git diff --check` 通过。Web 生产构建输出 311.53 kB JavaScript（gzip 95.52 kB）。本次仍未运行浏览器视觉回归或 Docker Compose 端到端验证。

最终环境加载修正增加了直接导入实际 Vite 配置的 Node 测试，确认 `envDir` 指向包含 `.env.example` 和 `VITE_API_BASE_URL` 示例的项目根目录。该修正的配置/客户端聚焦测试 11 项、Web 全量 28 项、根目录 `typecheck`、`lint`、`build` 和 `git diff --check` 通过；Web 生产构建输出仍为 311.53 kB JavaScript（gzip 95.52 kB）。

API 开发环境修正的自动化测试同时检查实际 `@panshi/api` package script，并以临时 `.env` 和 TypeScript 探针执行相同 Node watch/环境/tsx 选项顺序；探针读取到环境标记后终止，不连接数据库也不监听端口。该修正的 API 命令/启动聚焦测试 47 项、根目录 `typecheck`、`lint`、`build` 和 `git diff --check` 通过。

本次公开内容边界加固验证结果：contracts 47 项、Web 30 项、无数据库 API 测试 53 项通过（PostgreSQL 边界 3 项明确跳过）；必须的 `test:integration:content` 在本机专用 `panshi_ai4s_camp_test` 上 8 项通过，缺少 `TEST_DATABASE_URL` 时的命令立即以非零状态退出。根目录 `typecheck`、`lint`、`build`、`git diff --check` 通过，`npm audit --omit=dev` 报告 0 个漏洞。Web 生产构建输出 312.90 kB JavaScript（gzip 95.95 kB）。

## 质量命令

```bash
node tests/workspaces.test.mjs
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

API 无数据库单元/运行壳测试可显式运行 `npm test -w @panshi/api -- health.test.ts dev-command.test.ts`。内容仓库、发布指针和种子幂等性属于必须的 PostgreSQL 集成边界，使用 `npm run test:integration:content -w @panshi/api`；该命令缺少 `TEST_DATABASE_URL` 时立即失败，且只接受数据库名精确为 `panshi_ai4s_camp_test` 的 PostgreSQL URL。API schema 集成测试同样必须按上文显式提供专用测试数据库；`typecheck` 和 `build` 会逐一检查各 workspace。

公开站点的 Playwright 视觉测试使用本机已安装的 Chromium，并按操作系统保存快照：

```bash
npm run visual:test
npm run visual:update
```

`visual:test` 只比较当前平台已有的基线，不会改写图片；`visual:update` 才生成或更新当前平台基线。快照文件名包含 Playwright 的 `{platform}` 值（例如 `darwin` 或 `linux`），因此 macOS 与 Linux CI 各自维护对应基线。首次在新平台运行时，应在固定 Node、Playwright/Chromium、字体和视口环境中执行 `visual:update`，人工检查生成图片后再提交。测试中的 source-vs-migrated 直接 PNG 对比始终要求零个 RGBA 通道差异，但该比较只在同一次运行、同一渲染环境内成立，不跨操作系统复用像素结果。

环境变量从 `.env.example` 复制后按本机环境填写；示例文件不保存真实凭据。
