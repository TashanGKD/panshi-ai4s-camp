# 磐石 AI4S 实训营站点

这是一个面向单次 AI4S 实训营的独立 npm workspaces 项目，采用模块化单体结构。共享 contracts、PostgreSQL 数据库与迁移基础、公开内容 API、管理员与学员 Cookie 会话、手机号注册和密码重置、草稿／同源预览／版本化发布能力，以及结构化内容工作台和真实数据摘要已经实现。报名表、报名提交和资料管理等业务路由属于后续任务。

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

管理后台的 Vite 配置同样从项目根目录加载 `VITE_API_BASE_URL`，并把 Vite 的实际 `import.meta.env.PROD` 传给客户端配置校验。生产构建只允许空值（同源）或 HTTPS API；开发模式仅允许 HTTPS，或精确的 `localhost`、`127.0.0.1`、`::1` 回环 HTTP。跨 origin 时身份请求使用 `credentials: 'include'`，不在浏览器存储中推断或保存登录态。`VITE_PUBLIC_WEB_BASE_URL` 使用相同的生产 HTTPS／开发回环 HTTP 规则，后台预览按钮只打开 `/preview/:module`，不在 URL 中附加 token。

根目录 `.env.example` 的本地分端口默认值为 `VITE_API_BASE_URL=http://localhost:3001`，Web 默认由 Vite 在 `http://localhost:5173` 提供。配置值必须是不含凭据、query 或 fragment 的绝对 HTTP(S) URL，可含基础路径，末尾斜杠会被规范化；非法或不安全值会在客户端初始化时明确拒绝。使用已配置的 API origin 时，`fetch` 携带 `credentials: 'include'`，所以 API 的 `CORS_ORIGINS` 必须包含实际 Web origin；同源回退使用 `credentials: 'same-origin'`。

### 内容预览与发布

后台按基本信息、实训特色、组织单位、重要日期、实训日程与师资、住宿交通、联系方式和展示设置提供专用结构化表单。多段简介、每位联系人的多种联系方式、每节课程的多条内容要点及其他集合项均可独立编辑，并通过明确按钮添加、删除和排序；排序节点使用仅存在于前端的稳定 key，不写入严格业务 schema。后台不提供任意 JSON 编辑入口。富文本在服务端草稿读取、预览响应、编辑器 DOM 写入及保存前均使用严格白名单清洗。未保存编辑会禁用预览和发布；保存成功响应成为新的 clean baseline。保存、发布和回退共享同步操作锁，异步加载及写回按模块 generation 隔离。保存必须提交加载时的 `expectedRevision`，冲突返回 `CONTENT_CONFLICT`；发布错误会关联到具体字段。公共 Web 的 `/preview/:module` 使用管理员 HttpOnly Cookie 读取受保护草稿，并通过与正式页面相同的模块渲染组件和 `PublicShell` 展示；未登录或无权限时只显示登录／禁止状态。

展示设置新增可选 `homeSectionOrder`，仅接受不重复的 `intro`、`target`、`features`、`organizations`，后台可访问地排序并随草稿保存。当前公共首页聚合尚不包含实训特色和组织单位，Task 9 不扩大该接口边界；公开页消费点留待首页聚合完整后接入。

工作台通过 `GET /api/v1/admin/summary` 从 PostgreSQL 汇总报名总量与状态、待审核数量、临近重要日期、未发布草稿和最近操作；临近日期的“今天”按 `Asia/Shanghai` 业务日期计算。空库只显示零值与空状态，不填充演示数字；最近操作不返回 audit metadata 或内容正文。“相关资料”目前只展示 Task 15 待建设状态，不虚构资料编辑接口。

发布在按模块加锁的 PostgreSQL 事务内完成。校验失败不会创建版本或移动线上 pointer；历史版本由数据库 trigger 禁止 UPDATE/DELETE；回退会先按当前规则重新校验历史 payload，再复制为新版本。旧版 importantDates、schedule 和 contacts 仍可公开读取，草稿允许不完整保存，但新发布/回退必须满足完整机器日期、课程时间与 speaker 引用、结构化联系人规则。保存、发布、回退均记录脱敏结构摘要。具体 endpoint、字段错误和关联校验见 `docs/api.md`。

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

TEST_DATABASE_URL='postgresql://panshi:panshi_local@127.0.0.1:5433/panshi_ai4s_camp_test' \
  npm run test:integration:auth -w @panshi/api

TEST_DATABASE_URL='postgresql://panshi:panshi_local@127.0.0.1:5433/panshi_ai4s_camp_test' \
  npm run test:integration:migrations -w @panshi/api

TEST_DATABASE_URL='postgresql://panshi:panshi_local@127.0.0.1:5433/panshi_ai4s_camp_test' \
  npm run test:integration:student-auth -w @panshi/api

# Task 8 的并发发布集成目标按要求只接受这一精确本机 URL，并强制单 worker／文件串行。
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' \
  npm run test:integration:publishing -w @panshi/api
```

上述账号和密码是与 `compose.yaml` 对齐的本地开发占位值，绝不能用于生产环境。迁移按文件名顺序执行，已应用文件由数据库内的 `panshi_schema_migrations` 记录；重复执行安全，已应用迁移被修改时会拒绝继续。

数据库集成测试必须显式提供 `TEST_DATABASE_URL`，且数据库名必须恰好为 `panshi_ai4s_camp_test`；测试不会回退到 `DATABASE_URL`。测试清理会截断领域表，因此禁止指向开发库或任何名称相近但不完全相同的数据库。

`audit_logs.actor_user_id` 使用 `ON DELETE RESTRICT` 保留不可变的审计归属。用户停用应更新 `users.disabled_at`，而不是删除用户记录。

## 管理员账号与会话

```bash
DATABASE_URL='postgresql://...' npm run db:migrate -w @panshi/api
DATABASE_URL='postgresql://...' npm run admin:create -w @panshi/api -- --phone 13800138000 --name 管理员
```

CLI 使用隐藏输入从终端读取密码，不接受 `--password` 或任何口令参数，也不内置凭据。CLI、登录请求、profile 契约和数据库约束共享严格的中国大陆手机边界：只接受完整的 `1[3-9]` 加 9 位数字或精确 `+86` 等价值，并规范化为 `+861xxxxxxxxxx`；不从周边文本提取号码，也不接受座机或空格分隔形式。重复号码由数据库唯一约束拒绝。密码统一要求 8–72 UTF-8 字节，使用 bcrypt cost 12；验证前会拒绝结构或 cost 不符合要求的存量 hash，并通过固定 dummy hash 安全失败。Task 7 只创建账号，不实现停用或删除命令；后续 Task 16 必须保证不能停用或删除最后一个有效管理员。

`SESSION_TTL_SECONDS` 默认 `28800` 秒（8 小时），允许 300–604800 秒。登录事务锁定对应用户行，在同一事务内撤销旧会话、写入 replacement session 并追加成功登录审计；同一用户并发登录时最后提交的轮换获胜，最终仅一个返回 token 有效，审计失败会整体回滚。token 使用 32 字节安全随机数，数据库只保存 SHA-256 摘要，审计 metadata 不含 token 或密码。`panshi_session` Cookie 设置 `HttpOnly; SameSite=Lax; Path=/`，仅 `NODE_ENV=production` 增加 `Secure`；退出对缺失、未知、过期、已撤销或已轮换 token 都幂等返回 204，并用匹配属性清除 Cookie。只在真实 identity 与 auth transaction 依赖同时存在时挂载身份路由；生产服务器始终提供两者。

写请求必须带 `CORS_ORIGINS` allowlist 中的 `Origin`，缺失或恶意 Origin 返回 403。当前 Task 7 没有登录限流或独立 CSRF token，不应宣称已有暴力破解防护；这两项保留给后续安全加固。

## 学员手机号账号

学员使用 `/register`、`/login` 和 `/forgot-password` 完成三步注册、登录和密码重置。手机号与管理员共用 `users` 表，以 `role=user` 区分；`GET /api/v1/me/profile` 对任意有效登录账号开放，而所有 `/api/v1/admin/*` 接口仍由后端管理员守卫拒绝普通学员。学员登录会轮换该用户会话；密码重置在一个事务中消费验证码、更新 bcrypt hash、撤销该用户全部旧会话并写脱敏审计。

验证码通过 `VerificationProvider` 适配。数据库仅保存带服务端 secret 的 HMAC-SHA256 摘要、用途、过期时间、失败次数和消费时间，不保存明文。发送阶段按手机号执行 cooldown，且不会查询或泄露账号是否存在。`VERIFICATION_PROVIDER` 安全默认值为 `disabled`，此时发送接口返回 503；`mock` 只允许 `development` 或 `test`，生产配置为 `mock` 会在启动配置解析阶段失败。启用 mock 时必须在未跟踪的本地环境中提供至少 32 UTF-8 字节的 `VERIFICATION_SECRET`；固定 `VERIFICATION_MOCK_CODE` 只允许 `NODE_ENV=test`。

student-auth 浏览器测试只接受精确专用测试库，并要求所有测试手机号、密码、验证码和 HMAC secret 由运行环境显式提供。fixture 会先迁移、清空、建立公开内容和密码重置测试账号，退出 trap 与全局 teardown 均执行清理：

```bash
STUDENT_AUTH_E2E=1 \
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' \
E2E_VERIFICATION_CODE='<six-digit-test-code>' \
E2E_REGISTER_PHONE='<dedicated-register-phone>' \
E2E_REGISTER_PASSWORD='<dedicated-register-password>' \
E2E_RESET_PHONE='<dedicated-reset-phone>' \
E2E_RESET_PASSWORD='<dedicated-reset-password>' \
E2E_RESET_NEW_PASSWORD='<dedicated-new-password>' \
VERIFICATION_SECRET='<test-only-hmac-secret-at-least-32-bytes>' \
  npm run e2e:student-auth
```

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
身份 SQL/session 生命周期的必须集成边界使用 `npm run test:integration:auth -w @panshi/api`；它同样要求显式 `TEST_DATABASE_URL` 且数据库名必须精确为 `panshi_ai4s_camp_test`，缺少时在加载测试前失败。
`0003_user_display_name.sql` 的真实前向迁移边界使用 `npm run test:integration:migrations -w @panshi/api`；测试在专用测试数据库的一次事务内创建唯一隔离 schema，运行真实 0001/0002、插入 pre-0003 用户、再运行真实 0003，并回滚整个隔离 schema。它不会修改旧 migration，也不会接触其他数据库。

Task 8 的真实浏览器流使用独立配置启动 API、Web 与 admin。必须显式提供专用测试库和临时测试管理员凭据；凭据不写入仓库。fixture 只有在 `PUBLISHING_E2E=1` 且数据库 URL 精确匹配专用测试库时才会 seed/cleanup，并且只由测试命令调用：

```bash
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' \
PUBLISHING_E2E=1 \
E2E_ADMIN_PHONE='<dedicated-test-phone>' \
E2E_ADMIN_PASSWORD='<dedicated-test-password>' \
  npm run e2e:content
```

该命令在 API 启动前显式执行 migration，再建立发布测试 fixture；API 进程退出 trap 与 Playwright 全局 teardown 都会尝试清理。因而它可以从已创建但尚无 schema 的精确测试库启动，并在测试失败时仍执行兜底清理。公开资料是否具备文件只在资料自身的公开/可见性变更边界校验（Task 15），不与基本信息、日程等内容模块的发布和回退耦合。

## Task 7 验证记录（2026-08-14）

本次按 RED→GREEN 完成身份契约、拒绝优先 API、CLI、数据库会话与管理后台守卫测试。GREEN 后的分层结果为：contracts 48 项；API 无数据库集 70 项通过、3 项数据库用例按设计跳过；schema 20 项；内容集成 8 项；身份 SQL/session 集成 1 项；admin 9 项；Web 30 项。身份集成命令已确认在缺少 `TEST_DATABASE_URL` 或数据库名不精确时非零退出，并在本机 PostgreSQL `panshi_ai4s_camp_test` 上通过。根目录 typecheck、lint、build、`npm audit --omit=dev` 和 `git diff --check` 也纳入本任务最终校验。

### Task 7 安全边界加固复验（2026-08-14）

本次加固的无数据库结果为：contracts 67 项通过；API unit 101 项通过，另有 3 项 PostgreSQL 内容用例因未提供测试数据库而明确跳过；admin 26 项通过。根目录 typecheck、lint、build 通过，`npm audit --omit=dev` 报告 0 个生产依赖漏洞。完整 `npm audit` 仍报告来自 `drizzle-kit` 开发依赖链旧版 esbuild 的 4 个 moderate 漏洞；自动修复要求强制降级到 breaking 版本，因此本次未执行 `npm audit fix --force`。

当前执行环境没有设置 `TEST_DATABASE_URL`，所以精确的 auth integration、隔离 schema 的 0003 forward migration integration、以及完整 schema integration 都在加载测试前按安全门禁非零退出；本记录不声称这三组 PostgreSQL 测试已通过。运行命令和专用测试数据库限制见上文。

## Task 8 验证记录（2026-08-14）

本次按 RED→GREEN 实现并验证：contracts 77 项；API 无数据库聚焦集 119 项通过、3 项既有 PostgreSQL 用例按设计跳过；admin 38 项；Web 45 项。PostgreSQL 目标按顺序独立运行：schema 24 项、公开内容 8 项、身份 3 项、前向迁移 1 项、Task 8 发布事务 6 项均通过。Task 8 的 Playwright 真实浏览器流 1 项通过，覆盖匿名预览拒绝、管理员登录、保存草稿、同源组件预览、发布、回退、公共读取和审计脱敏。

根目录 workspace 检查、typecheck、lint、build、`git diff --check` 均通过；`npm audit --omit=dev` 为 0 个漏洞。完整 `npm audit` 仍报告 `drizzle-kit` 开发依赖链旧版 esbuild 的 4 个 moderate 漏洞，自动修复会强制降级到 breaking 版本，未执行 `npm audit fix --force`。无环境变量运行 E2E fixture 会按安全门禁非零退出。

Task 8 规格复核修订后，标准视觉配置只接受显式 `VISUAL_E2E=1` 和精确本机测试库 URL。它先迁移专用测试库，以初始公开内容 seed 建立确定性 API fixture，待 API 健康后再启动 Web，并在全局 teardown 及 API 进程退出 trap 中安全清理。视觉用例会先断言真实活动标题且无错误壳，再执行截图和样式检查；`.public-sidebar .info-card` 使用当前生产 selector。三张 `public-home` macOS 基线只在检查 API 驱动 actual 后更新，截图阈值仍为零差异，同轮 source/migrated RGBA 比较仍要求零通道差异。

本次规格复核的分层结果为：contracts 78 项；API 无数据库单元 121 项通过、3 项 PostgreSQL 用例按设计跳过；精确测试库的发布事务集成 8 项；admin 38 项；Web 46 项；发布 Playwright E2E 1 项；三平台视觉回归 24/24。workspace 结构、typecheck、lint、build、`npm audit --omit=dev` 与 `git diff --check` 纳入最终门禁。完整 `npm audit` 仍是既有 `drizzle-kit` 开发依赖链的 4 个 moderate 漏洞，自动修复需要 breaking 版本变更，未强制修改。两套浏览器 fixture 结束后均确认专用库已清空；未运行 Docker Compose。

公开站点的 Playwright 视觉测试使用本机已安装的 Chromium，并按操作系统保存快照：

```bash
VISUAL_E2E=1 \
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' \
  npm run visual:test

# 只在人工检查稳定 actual 后使用；不得用于掩盖失败。
VISUAL_E2E=1 \
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' \
  npm run visual:update
```

`visual:test` 只比较当前平台已有的基线，不会改写图片；`visual:update` 才生成或更新当前平台基线。两个命令都会拒绝缺少显式开关或不精确的测试数据库，并在结束时清空 fixture 数据，不得指向开发或生产数据库。快照文件名包含 Playwright 的 `{platform}` 值（例如 `darwin` 或 `linux`），因此 macOS 与 Linux CI 各自维护对应基线。首次在新平台运行时，应在固定 Node、Playwright/Chromium、字体和视口环境中执行 `visual:update`，人工检查生成图片后再提交。测试中的 source-vs-migrated 直接 PNG 对比始终要求零个 RGBA 通道差异，但该比较只在同一次运行、同一渲染环境内成立，不跨操作系统复用像素结果。

环境变量从 `.env.example` 复制后按本机环境填写；示例文件不保存真实凭据。
