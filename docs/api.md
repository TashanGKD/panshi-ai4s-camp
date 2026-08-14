# API 契约边界

本文冻结磐石 AI4S 实训营的共享 API 契约，供服务端与客户端共同遵循。当前已实现 API 运行壳、健康检查、公开内容读取、管理员身份、内容草稿／预览／发布／历史／回退，以及 Task 9 的后台摘要边界；报名和资源下载路由仍属于后续任务。

## API 范围

本 API 只服务当前这一场活动，是 single-event API。契约不包含 `eventId`、tenant、edition，也不提供多租户或多活动抽象。

规划中的 `/api/v1` 边界分为：

- `/api/v1/public`：无需登录的站点内容与公开资源。
- `/api/v1/auth`：登录、退出和 Cookie session 生命周期。
- `/api/v1/me`：当前用户、报名快照和按登录或录取状态开放的资源。
- `/api/v1/admin`：统一管理员角色使用的内容、报名审核和资源管理能力。

具体方法、子路径、请求体与成功响应只有在 endpoint 实现并补充契约后才可视为可用接口。`GET /healthz` 执行一次有界超时的 `SELECT 1` 数据库检查，查询本身使用不长于 HTTP health deadline 的 per-query timeout，外层 Promise deadline 作为最终保护。健康时精确返回 `{ "status": "ok", "database": "ok" }`；数据库拒绝或超时返回不含内部原因的 503 `SERVICE_UNAVAILABLE`。所有响应均携带 `X-Request-Id`。

已实现的公开内容接口为：

- `GET /api/v1/public/site`：只聚合已发布的 `basic`、`importantDates`、`contacts`、`display`，不包含 `schedule` 或草稿。
- `GET /api/v1/public/schedule`：只返回已发布的 `schedule`。
- `GET /api/v1/public/content/:key`：按固定模块 key 返回单个已发布模块；`schedule` 必须使用独立接口，因此在此路径返回 404。

已实现的身份接口为：

- `POST /api/v1/auth/admin/login`：请求体含 `phone` 和 `password`；手机号只接受完整的 `1[3-9]` 加 9 位数字或精确 `+86` 等价值并规范化为 E.164，密码必须为 8–72 UTF-8 字节。仅有效且未停用的 `admin` 可成功，错误凭据返回 401，普通用户或停用管理员返回 403。
- `POST /api/v1/auth/admin/logout`：若 Cookie 中存在 token，按 SHA-256 hash 幂等撤销；无论 token 缺失、未知、过期、已撤销或已轮换，都用匹配属性清除 Cookie 并返回 204。Origin 保护仍先于路由执行。
- `GET /api/v1/me/profile`：返回 `id`、`displayName`、`phoneNormalized` 和 `role`；未知、过期或已撤销会话返回 401，非管理员或已停用账号返回 403。

已实现的管理员内容接口均要求真实 `panshi_session` Cookie 和 `admin` 角色：

- `GET /api/v1/admin/content/:key/draft`：读取草稿 payload、当前 `revision` 和已发布版本号。
- `PUT /api/v1/admin/content/:key/draft`：请求 `{ "expectedRevision": n, "payload": {} }`。数据库使用单条 `UPDATE ... WHERE draft_revision = expectedRevision RETURNING` 完成 compare-and-swap；过期 revision 返回 409 `CONTENT_CONFLICT`。
- `GET /api/v1/admin/content/:key/preview`：为公共 Web `/preview/:module` 返回受保护草稿。该 GET 只接受管理员 Cookie；无会话、无效会话和非管理员均返回 403 `FORBIDDEN`，不签发公开 token，不生成可转发预览链接。该特殊边界不改变 `GET /api/v1/me/profile` 无会话时的 401 `UNAUTHORIZED` 语义。
- `POST /api/v1/admin/content/:key/publish`：请求 `{ "expectedRevision": n }`。事务按模块行加锁，在事务内校验草稿、分配递增版本、插入不可变版本、更新发布指针并写审计。
- `GET /api/v1/admin/content/:key/versions`：按版本号倒序返回不可变历史 payload、创建人和时间。
- `POST /api/v1/admin/content/:key/rollback`：请求 `{ "version": n }`；在模块锁定事务内重新执行当前发布校验，通过后复制历史 payload 创建一个新版本并移动指针，不修改历史行。历史版本若只满足旧版读取契约但不满足当前发布规则，回退会以 422 拒绝且 pointer/history 不变。

已实现的管理后台摘要接口同样要求真实管理员 Cookie：

- `GET /api/v1/admin/summary`：从数据库实时返回报名总量、完整状态分布、待审核数量（`submitted + reviewing`）、未来最近五个机器日期、与当前发布版本不同的草稿，以及最近十条管理员操作。空库返回完整零值和空数组。最近操作只包含日志 ID、动作、操作者显示名和时间，不返回 audit metadata、正文、联系方式或其他敏感值。未登录返回 401，已登录非管理员返回 403。

Task 9 的管理端通过上述摘要与内容接口实现结构化内容工作台。富文本仅允许 `p`、`br`、`strong`、`em`、`ul`、`ol`、`li` 和安全 `a[href]`，仅接受 `http`、`https`、`mailto` 协议；保存前再次清洗，禁止 `script`、`iframe`、内联事件属性和 `javascript:` URL。基本信息的多段简介、联系人的多种联系方式、日程课程的多条内容要点以及其他集合字段均使用独立字段和显式添加、删除、上移、下移操作，不以 JSON 文本框代替业务表单。`相关资料` 仍无创建或上传接口，留待 Task 15。

`display.homeSectionOrder` 是可选的首页模块顺序数组，允许值仅为 `intro`、`target`、`features`、`organizations`，且同一数组内不得重复。Task 9 已完成该字段的契约校验、后台排序和草稿保存；当前首页聚合接口尚未返回 `features` 与 `organizations`，因此公开首页暂不消费该字段，避免在 Task 9 中扩张公共聚合与页面发布边界。后续接入时应直接以该字段作为首页模块顺序信息真源。

管理员内容路由只有在真实会话依赖和内容发布 service 同时存在时才挂载。保存、发布和回退审计只记录 actor、模块、revision/version 和结构摘要，不记录正文、联系值或其他原始 payload。写请求继续执行精确 Origin allowlist 校验。

Task 6 不提供资料记录或下载 endpoint。Web 的 `相关资料` 路由使用 App 已完成的上述 `GET /api/v1/public/site` 请求与契约校验，不单独重复请求；App 成功后页面显示真实空状态，App 失败时保留顶层错误。`apps/api/src/modules/resources` 及 public/authenticated/admitted 资料权限由 Task 15 实现，不属于当前 API 能力。

模块没有 `published_version_id` 时返回 404 `CONTENT_NOT_FOUND`，不会回退读取 `content_modules.draft`。数据库中的已发布 payload 会在服务边界按对应 Zod schema 再验证；无效 payload 进入统一 500 `INTERNAL_ERROR`，响应不包含原始数据库值或校验细节。

发布校验返回 422 `CONTENT_VALIDATION_FAILED`，`error.details.fields` 为稳定的 `{ path, code, message }[]`，不直接返回 Zod issue、stack 或无清洗的输入。关联规则如下：

- `importantDates.items[].machineKey` 可选值为 `registrationOpen`、`registrationDeadline`、`campStart`、`campEnd`。旧版无机器键 payload 仍可公开读取，草稿也可不完整保存；但发布或回退必须四键各恰好一项，不从中文 label 猜测。日期必须真实，报名开放日严格早于截止日，实训开始日不得晚于结束日，且实训日期在已发布 `basic.dates` 可用时必须一致。缺项、重复和关系错误均返回具体字段路径。
- `schedule.days[].sessions[].timeRange` 使用 `{ start: "HH:mm", end: "HH:mm" }` 且 start 严格早于 end。空 `sessions` 合法；每个实际 session 都必须提供机器范围。公共读取仍兼容历史 `time` 显示字符串，但它不能替代新发布所需的 `timeRange`。
- `schedule.speakers` 使用稳定 `id`，session 使用 `speakerIds`；讲师 ID、单节引用不得重复，每个非空引用必须存在。无讲师课程可省略或使用空 `speakerIds`。历史非空 `instructors` 字符串只保留公共显示兼容，任何新发布或回退都拒绝该字段中的非空值。
- `contacts` 公开读取继续兼容历史 `{ label, value, href? }` 项和空列表；新发布或回退则至少需要一项 `{ name, responsibility, methods, consultationNote? }`。`methods` 至少含一个安全的 `{ type: "phone" | "email", value }`，所有联系人都必须完整结构化，错误返回 `items.n...` 字段路径。初始 seed 仍为空，不虚构联系人。
- 资料完整性由 Task 15 的资料公开/可见性变更边界负责，不参与内容模块发布校验。
- legacy 关联域缺失不会阻塞其他模块发布；例如旧版无机器键的重要日期不会阻塞 `basic`。但发布 `importantDates`、`schedule` 或 `contacts` 自身时必须满足上述当前规则。

## API 运行基线

API 进程读取并校验 `DATABASE_URL`、`API_PORT`、`NODE_ENV`、`SESSION_TTL_SECONDS` 和逗号分隔的 `CORS_ORIGINS`。`SESSION_TTL_SECONDS` 默认 28800 秒（八小时），允许 300–604800 秒，不提供 remember-me。JSON 请求体上限通过 `JSON_BODY_LIMIT` 设置，默认 `1mb`，允许范围为 1KB 至 10MB，启动前会转换为字节数。数据库健康检查超时由 `HEALTHCHECK_TIMEOUT_MS` 设置，默认 2000ms，允许范围为 100–10000ms。`CORS_ORIGINS` 中每项必须是规范化、无路径、无凭据的完整 HTTP(S) origin；重复项会去重，空值表示不允许任何跨源状态变更请求。

中间件固定顺序为请求 ID、JSON body limit、Cookie 解析、CORS/Origin 保护、路由、统一 404/错误处理。安全方法 `GET`、`HEAD`、`OPTIONS` 不受 Origin 拦截；状态变更方法必须携带 allowlist 中的 `Origin`，缺少或不匹配都返回 403。独立 CSRF token 和登录限流尚未实现。

JSON parser 的稳定客户端错误由统一错误层转换：格式错误返回 400 `MALFORMED_JSON`，不支持的 charset 或 content encoding 返回 415 `UNSUPPORTED_MEDIA_TYPE`，请求体超限返回 413 `PAYLOAD_TOO_LARGE`；响应不会包含 parser 原始消息或请求片段。

服务启动不会执行 migration 或创建表；schema 变更只通过显式 `npm run db:migrate -w @panshi/api` 完成。监听失败会经过受控的通用错误路径并关闭数据库 pool。收到 `SIGINT` 或 `SIGTERM` 后，服务先停止接受新请求并等待 HTTP close/drain 完成，再关闭数据库；即使 HTTP close 失败也仍会尝试关闭数据库。重复信号在 shutdown pending 期间继续由已安装的 handler 接收，并共享同一个关闭 Promise；handler 在关闭结束后移除。HTTP server 和数据库 pool 均最多关闭一次。监听后的 server error 属于 fatal runtime error，顺序清理后只报告通用错误并设置非零退出码。可复用生命周期逻辑不直接调用 `process.exit`。

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

内容字段错误的 `details` 示例：

```json
{
  "fields": [
    {
      "path": "days.0.sessions.0.timeRange.end",
      "code": "INVALID_TIME_RANGE",
      "message": "结束时间必须晚于开始时间"
    }
  ]
}
```

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
- Cookie 名为 `panshi_session`，`Path=/`；默认使用 host-only Cookie，不设置宽泛 `Domain`。
- 身份认证成功或权限变化后必须轮换 session；退出登录、密码重置或 session reset 后必须使旧 session 失效。
- 当前状态变更请求必须校验受信 Origin；`GET`、`HEAD`、`OPTIONS` 不得产生状态变更。

密码统一要求 8–72 UTF-8 字节并使用 bcrypt cost 12。验证存量 hash 前必须校验完整 bcrypt 格式和 cost 12；结构错误或旧 cost 通过固定 cost-12 dummy hash 比较路径安全失败，不得抛出或暴露差异。未知但格式有效的手机号同样走 dummy hash 路径。会话 token 由 `randomBytes(32)` 生成，数据库只保存 SHA-256 hash，audit metadata、错误和日志不得包含 token 或密码。

管理员登录的会话轮换与 `auth.login_succeeded` 审计属于同一数据库事务。事务按用户行加锁，串行撤销该用户所有 active session、插入 replacement session、追加强制审计；并发登录最终只保留最后提交事务的 token 有效，任一写入失败都会回滚整个轮换。只有 identity repository 和 auth transaction repository 同时存在时才挂载身份路由；健康检查或纯公开内容 App 可以省略两者，此时不暴露伪造的 auth endpoint。生产服务器始终注入真实 PostgreSQL 实现。

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

`@panshi/contracts` 当前定义并导出：统一错误、分页元数据、用户角色、报名状态、公开内容模块、资源访问级别、公开站点响应、管理员登录请求/响应、profile 响应和提交报名快照。

公开内容模块使用固定的后端内容 key：`basic`、`features`、`organizations`、`importantDates`、`schedule`、`contacts`、`travel`、`display`。这些 key 不是页面路由，不提供路由名称 alias。

公开站点聚合响应包含 `contentVersion`，以及 `basic`、`importantDates`、`contacts`、`display` 四个已发布 payload；`schedule` 保持独立，不混入该最小聚合。八个模块分别使用 `BasicContentSchema`、`FeaturesContentSchema`、`OrganizationsContentSchema`、`ImportantDatesContentSchema`、`ScheduleContentSchema`、`ContactsContentSchema`、`TravelContentSchema`、`DisplayContentSchema` 校验。公开 Web 客户端再次按共享响应契约解析 HTTP payload，不导入数据库代码。

公开响应的顶层和 `data` envelope 会容忍并剥离 v1 未知增量字段，但缺失必需字段、错误 `apiVersion` 或错误必需字段类型仍会被拒绝。公开内容 payload 保持按模块严格校验。内容日期必须是真实 Gregorian `YYYY-MM-DD`，`basic.dates.start` 不得晚于 `end`；日程共用同一日期校验。联系链接只允许不含凭据的 `https:`、合法邮箱的 `mailto:` 和合法号码的 `tel:`。

报名快照表示某次提交时的 `formVersion`、`submittedAt` 和 JSON-safe 答案副本。解析后的快照及其嵌套对象、数组均不可变。它不是可在线修改的表单定义；补充或再次提交应产生新的版本化快照，而不是改写既有快照。
