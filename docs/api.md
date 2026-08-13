# API 契约边界

本文冻结磐石 AI4S 实训营的共享 API 契约，供后续服务端与客户端实现共同遵循。当前阶段提供可构建、可由 Node.js 消费的 `@panshi/contracts` Zod schema、序列化 helper 和类型，并已建立 API 运行壳与 `GET /healthz`；下述业务路由仍是规划中的边界分组，不代表对应 endpoint 已实现或可访问。

## API 范围

本 API 只服务当前这一场活动，是 single-event API。契约不包含 `eventId`、tenant、edition，也不提供多租户或多活动抽象。

规划中的 `/api/v1` 边界分为：

- `/api/v1/public`：无需登录的站点内容与公开资源。
- `/api/v1/auth`：登录、退出和 Cookie session 生命周期。
- `/api/v1/me`：当前用户、报名快照和按登录或录取状态开放的资源。
- `/api/v1/admin`：统一管理员角色使用的内容、报名审核和资源管理能力。

具体方法、子路径、请求体与成功响应只有在后续 endpoint 实现并补充契约后才可视为可用接口。当前唯一可用 endpoint 是 `GET /healthz`：它执行一次 `SELECT 1` 数据库检查，健康时精确返回 `{ "status": "ok", "database": "ok" }`，且所有响应均携带 `X-Request-Id`。

## API 运行基线

API 进程读取并校验 `DATABASE_URL`、`API_PORT` 和逗号分隔的 `CORS_ORIGINS`；JSON 请求体上限可通过 `JSON_BODY_LIMIT` 设置，默认 `1mb`。`CORS_ORIGINS` 中每项必须是无路径、无凭据的完整 HTTP(S) origin。开发命令为 `npm run dev -w @panshi/api`。

中间件固定顺序为请求 ID、JSON body limit、Cookie 解析、CORS/Origin 基线保护、路由、统一 404/错误处理。安全方法 `GET`、`HEAD`、`OPTIONS` 不受 Origin 拦截；状态变更方法必须携带 allowlist 中的 `Origin`，缺少或不匹配都返回 403。允许的 `OPTIONS` 预检返回对应 CORS header；任意来源不会被反射。该规则是 Cookie 认证上线前的 Origin 基线，后续身份任务仍需增加 CSRF token 校验。

服务启动不会执行 migration 或创建表；schema 变更只通过显式 `npm run db:migrate -w @panshi/api` 完成。收到 `SIGINT` 或 `SIGTERM` 后，服务停止接受新请求并只关闭一次数据库 pool。

## 统一错误格式

所有后续 `/api/v1` endpoint 的非成功响应必须使用同一顶层错误对象：

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "未登录",
    "requestId": "r1",
    "details": {}
  }
}
```

- `code`：非空、稳定、可供程序判断的错误码。
- `message`：非空、面向用户或调用方的错误说明。
- `requestId`：非空请求标识，用于日志关联与排查。
- `details`：可选的键值对象，只承载该错误的补充结构化信息。

客户端不得依赖 `message` 文案分支；程序逻辑应依赖 `code`。新增错误信息时不得改变上述顶层结构。

错误生产端必须遵守以下安全规则：

- `details` 必须可 JSON 序列化，并按每个错误码使用明确 allowlist 构造；schema 中的 `unknown` 不代表它会自动清洗或脱敏。
- `details` 严禁包含凭据、Cookie 或 Authorization header、任何 token、密码、stack trace 或原始内部对象。
- handler 必须新建安全错误 payload，通过 `ApiErrorSchema.parse` 后发送解析结果；不得只调用 `safeParse`，然后继续发送原始对象。

## Session 与身份

登录态使用 Cookie-based session。登录成功响应只返回版本化的用户摘要，不返回 bearer token 或 session secret；浏览器在后续请求中携带服务端设置的 session Cookie。服务端 handler 必须将输入交给 `serializeLoginResponse`，并发送它返回的解析结果；不得只校验后发送仍可能携带 `token`、`sessionToken` 或 `refreshToken` 的原始对象。

Cookie 和 session 实现必须满足以下安全底线：

- session Cookie 始终设置 `HttpOnly`；生产环境必须设置 `Secure`。
- 明确设置 `SameSite=Lax`，作为同站点 Web/API 架构的默认值；如未来跨站架构确需调整，必须同时重新评估 CSRF 防护。
- Cookie `Path` 限定为 `/api/v1`；默认使用 host-only Cookie，不设置宽泛 `Domain`，除非受信子域共享确有必要。
- 身份认证成功或权限变化后必须轮换 session；退出登录、密码重置或 session reset 后必须使旧 session 失效。
- 使用 Cookie 身份的状态变更请求必须校验 CSRF token 和受信 Origin；`GET`、`HEAD`、`OPTIONS` 不得产生状态变更，不能仅依赖 `SameSite` 作为 CSRF 防护。

具体 Cookie 名称和有效期由后续身份实现确定。

用户角色仅分为普通用户 `user` 和统一权限模型下的管理员 `admin`。资源访问级别为：

- `public`：公开访问。
- `authenticated`：登录后访问。
- `admitted`：录取后访问。

## 版本兼容规则

- `/api/v1` 是当前主版本边界；同一主版本内允许向响应对象增加可选字段。
- 同一主版本内不得删除或重命名既有字段，不得改变字段含义、既有枚举值或统一错误结构。
- 客户端应忽略未知的可选字段，但可以严格校验当前契约要求的字段。
- 删除字段、收紧既有输入、改变字段语义或作出其他破坏性变更时，必须启用新的 URL 主版本。
- 成功响应中的 `apiVersion: "v1"` 用于显式标识 envelope 版本，不能替代 URL 版本边界。

## 已冻结的共享契约

`@panshi/contracts` 当前定义并导出：统一错误、分页元数据、用户角色、报名状态、公开内容模块、资源访问级别、公开站点响应、登录响应和提交报名快照。

公开内容模块使用固定的后端内容 key：`basic`、`features`、`organizations`、`importantDates`、`schedule`、`contacts`、`travel`、`display`。这些 key 不是页面路由，不提供路由名称 alias。

公开站点聚合响应包含 `contentVersion`，以及 `basic`、`importantDates`、`contacts`、`display` 四个已发布 JSON-object payload。详细模块字段留待后续内容契约定义；`schedule` 保持独立，不混入该最小聚合。

报名快照表示某次提交时的 `formVersion`、`submittedAt` 和 JSON-safe 答案副本。解析后的快照及其嵌套对象、数组均不可变。它不是可在线修改的表单定义；补充或再次提交应产生新的版本化快照，而不是改写既有快照。
