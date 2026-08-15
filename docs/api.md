# API 契约边界

本文冻结磐石 AI4S 实训营的共享 API 契约，供服务端与客户端共同遵循。当前已实现公开内容、身份、报名、审核、文件、资料权限和报名人数统计。

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

- `POST /api/v1/auth/verification/send`：请求体含 `phone` 和 `purpose`（`register` 或 `reset_password`）。数据库先创建 `pending` 记录，provider 成功后转为 `sent`，明确拒绝则转为 `failed` 并返回 503 `VERIFICATION_UNAVAILABLE`。冷却只计入 `pending`、`sent`，核验只读取最新 `sent`。成功统一返回 204；发送过频返回 429 `VERIFICATION_RATE_LIMITED`。发送阶段不公开账号是否存在，也不返回验证码。
- `POST /api/v1/auth/register`：请求体含手机号、6 位验证码和 8–72 UTF-8 字节密码；成功创建 `role=user` 账号并通过独立的 `RegistrationResponseSchema` 返回 201 用户摘要，不设置会话 Cookie，后续须调用登录接口。重复手机号最终返回 409 `ACCOUNT_EXISTS`；验证码错误、过期、用途不匹配、尝试超限或已消费统一返回 400 `VERIFICATION_INVALID`。
- `POST /api/v1/auth/login`：学员手机号和密码登录。未知手机号、错误密码、停用账号或管理员账号均返回相同的 401 `INVALID_CREDENTIALS`；成功轮换会话并设置安全 Cookie。
- `POST /api/v1/auth/password/reset`：手机号、6 位验证码和新密码。仅未禁用的 `role=user` 账号可通过公共流程重置；管理员、禁用账号和不存在账号统一返回克制的 400 `PASSWORD_RESET_FAILED`。成功在同一事务消费验证码、生成并更新密码哈希、撤销该用户全部旧会话并写脱敏审计，返回 204。密码 bcrypt 只会在验证码、账号存在性、角色和状态全部通过后，于持有 advisory lock 和行锁的事务内执行。
- `POST /api/v1/auth/logout`：学员通用幂等退出并清除 Cookie。
- `POST /api/v1/auth/admin/login`：请求体含 `phone` 和 `password`；手机号只接受完整的 `1[3-9]` 加 9 位数字或精确 `+86` 等价值并规范化为 E.164，密码必须为 8–72 UTF-8 字节。仅有效且未停用的 `admin` 可成功，错误凭据返回 401，普通用户或停用管理员返回 403。
- `POST /api/v1/auth/admin/logout`：若 Cookie 中存在 token，按 SHA-256 hash 幂等撤销；无论 token 缺失、未知、过期、已撤销或已轮换，都用匹配属性清除 Cookie 并返回 204。Origin 保护仍先于路由执行。
- `GET /api/v1/me/profile`：返回 `id`、`displayName`、`phoneNormalized` 和 `role`；对有效的学员或管理员会话开放，未知、过期或已撤销会话返回 401。普通学员仍不能访问任何管理员接口。

已实现的管理员内容接口均要求真实 `panshi_session` Cookie 和 `admin` 角色：

- `GET /api/v1/admin/content/:key/draft`：读取草稿 payload、当前 `revision` 和已发布版本号。响应前按模块富文本白名单清洗历史数据库值。
- `PUT /api/v1/admin/content/:key/draft`：请求 `{ "expectedRevision": n, "payload": {} }`。数据库使用单条 `UPDATE ... WHERE draft_revision = expectedRevision RETURNING` 完成 compare-and-swap；过期 revision 返回 409 `CONTENT_CONFLICT`。
- `GET /api/v1/admin/content/:key/preview`：为公共 Web `/preview/:module` 返回受保护草稿。响应前按模块富文本白名单清洗历史数据库值。该 GET 只接受管理员 Cookie；无会话、无效会话和非管理员均返回 403 `FORBIDDEN`，不签发公开 token，不生成可转发预览链接。该特殊边界不改变 `GET /api/v1/me/profile` 无会话时的 401 `UNAUTHORIZED` 语义。
- `POST /api/v1/admin/content/:key/publish`：请求 `{ "expectedRevision": n }`。事务按模块行加锁，在事务内校验草稿、分配递增版本、插入不可变版本、更新发布指针并写审计。
- `GET /api/v1/admin/content/:key/versions`：按版本号倒序返回不可变历史 payload、创建人和时间。
- `POST /api/v1/admin/content/:key/rollback`：请求 `{ "version": n }`；在模块锁定事务内重新执行当前发布校验，通过后复制历史 payload 创建一个新版本并移动指针，不修改历史行。历史版本若只满足旧版读取契约但不满足当前发布规则，回退会以 422 拒绝且 pointer/history 不变。

已实现的管理后台摘要接口同样要求真实管理员 Cookie：

- `GET /api/v1/admin/summary`：从数据库实时返回报名总量、完整状态分布、待审核数量（`submitted + reviewing`）、未来最近五个机器日期、与当前发布版本不同的草稿，以及最近十条管理员操作。“今天”按 `Asia/Shanghai` 业务日期计算，并可通过 repository `todayProvider` 注入测试时间。空库返回完整零值和空数组。最近操作只包含日志 ID、动作、操作者显示名和时间，不返回 audit metadata、正文、联系方式或其他敏感值。未登录返回 401，已登录非管理员返回 403。

Task 9 的管理端通过上述摘要与内容接口实现结构化内容工作台。富文本仅允许 `p`、`br`、`strong`、`em`、`ul`、`ol`、`li` 和安全 `a[href]`，仅接受 `http`、`https`、`mailto` 协议；服务端读取草稿、预览响应、编辑器写入 DOM 和保存前均执行清洗，禁止 `script`、`iframe`、内联事件属性和 `javascript:` URL。基本信息的多段简介、联系人的多种联系方式、日程课程的多条内容要点以及其他集合字段均使用独立字段和显式添加、删除、上移、下移操作，不以 JSON 文本框代替业务表单。前端排序使用不进入业务 payload 的稳定编辑器 key。存在未保存编辑时，预览和发布不可用并提示先保存；保存、发布、回退共用单一同步操作锁，模块加载和写操作回调通过 generation guard 隔离。相关资料使用独立结构化工作台管理文件、范围、排序和发布状态。

`display.homeSectionOrder` 是可选的首页模块顺序数组，允许值仅为 `intro`、`target`、`features`、`organizations`，且同一数组内不得重复。Task 9 已完成该字段的契约校验、后台排序和草稿保存；当前首页聚合接口尚未返回 `features` 与 `organizations`，因此公开首页暂不消费该字段，避免在 Task 9 中扩张公共聚合与页面发布边界。后续接入时应直接以该字段作为首页模块顺序信息真源。

管理员内容路由只有在真实会话依赖和内容发布 service 同时存在时才挂载。保存、发布和回退审计只记录 actor、模块、revision/version 和结构摘要，不记录正文、联系值或其他原始 payload。写请求继续执行精确 Origin allowlist 校验。

`GET /api/v1/resources` 按匿名、登录、录取身份只返回当前账号可见的已发布资料；`GET /api/v1/resources/:id/download` 复用安全文件流。只有匿名请求已发布的公开资料时允许共享缓存，登录态下载一律使用 `private, no-store`。管理员通过 `GET /api/v1/admin/resources/:id/preview` 预览已发布或未发布资料，响应始终使用 `private, no-store`。受限或未发布资料在公共下载路由统一以 404 隐藏存在性。`GET /api/v1/public/statistics/applications` 只返回 `{visible:false}`，或在已发布展示设置开启时返回 `{visible:true,submittedCount,updatedAt}`；统计不包含草稿，前端在页面可见期间每 60 秒重新读取开关与人数。

模块没有 `published_version_id` 时返回 404 `CONTENT_NOT_FOUND`，不会回退读取 `content_modules.draft`。数据库中的已发布 payload 会在服务边界按对应 Zod schema 再验证；无效 payload 进入统一 500 `INTERNAL_ERROR`，响应不包含原始数据库值或校验细节。

发布校验返回 422 `CONTENT_VALIDATION_FAILED`，`error.details.fields` 为稳定的 `{ path, code, message }[]`，不直接返回 Zod issue、stack 或无清洗的输入。关联规则如下：

- `importantDates.items[].machineKey` 可选值为 `registrationOpen`、`registrationDeadline`、`campStart`、`campEnd`。旧版无机器键 payload 仍可公开读取，草稿也可不完整保存；但发布或回退必须四键各恰好一项，不从中文 label 猜测。日期必须真实，报名开放日严格早于截止日，实训开始日不得晚于结束日，且实训日期在已发布 `basic.dates` 可用时必须一致。缺项、重复和关系错误均返回具体字段路径。
- `schedule.days[].sessions[].timeRange` 使用 `{ start: "HH:mm", end: "HH:mm" }` 且 start 严格早于 end。空 `sessions` 合法；每个实际 session 都必须提供机器范围。公共读取仍兼容历史 `time` 显示字符串，但它不能替代新发布所需的 `timeRange`。
- `schedule.speakers` 使用稳定 `id`，session 使用 `speakerIds`；讲师 ID、单节引用不得重复，每个非空引用必须存在。无讲师课程可省略或使用空 `speakerIds`。历史非空 `instructors` 字符串只保留公共显示兼容，任何新发布或回退都拒绝该字段中的非空值。
- `contacts` 公开读取继续兼容历史 `{ label, value, href? }` 项和空列表；新发布或回退则至少需要一项 `{ name, responsibility, methods, consultationNote? }`。`methods` 至少含一个安全的 `{ type: "phone" | "email", value }`，所有联系人都必须完整结构化，错误返回 `items.n...` 字段路径。初始 seed 仍为空，不虚构联系人。
- 资料完整性由资料公开/可见性变更边界负责，不参与内容模块发布校验。
- legacy 关联域缺失不会阻塞其他模块发布；例如旧版无机器键的重要日期不会阻塞 `basic`。但发布 `importantDates`、`schedule` 或 `contacts` 自身时必须满足上述当前规则。

## API 运行基线

API 进程读取并校验 `DATABASE_URL`、`API_PORT`、`NODE_ENV`、`SESSION_TTL_SECONDS` 和逗号分隔的 `CORS_ORIGINS`。`SESSION_TTL_SECONDS` 默认 28800 秒（八小时），允许 300–604800 秒，不提供 remember-me。JSON 请求体上限通过 `JSON_BODY_LIMIT` 设置，默认 `1mb`，允许范围为 1KB 至 10MB，启动前会转换为字节数。数据库健康检查超时由 `HEALTHCHECK_TIMEOUT_MS` 设置，默认 2000ms，允许范围为 100–10000ms。附件根目录由 `FILE_STORAGE_ROOT` 配置，默认项目 `var/uploads`；应用独占上传临时目录由 `FILE_UPLOAD_TEMP_ROOT` 配置，默认位于存储根的 `.incoming`。单文件上限由 `FILE_UPLOAD_MAX_BYTES` 配置，默认及硬上限均为 5242880 字节。上传默认受全局 4 路、单账号 1 路并发门控，并限制全局每分钟 20 次、单账号每分钟 5 次；账号窗口表最多跟踪 10000 项并惰性清除过期项。`CORS_ORIGINS` 中每项必须是规范化、无路径、无凭据的完整 HTTP(S) origin；重复项会去重，空值表示不允许任何跨源状态变更请求。存储根的专用标记、权限和部署准备要求见 README；既有目录不由应用自动 `chmod`。

验证码配置包括 `VERIFICATION_PROVIDER`（默认 `disabled`）、`VERIFICATION_SECRET`、`VERIFICATION_TTL_SECONDS`（60–1800，默认 300）、`VERIFICATION_COOLDOWN_SECONDS`（10–600，默认 60）和 `VERIFICATION_MAX_ATTEMPTS`（1–10，默认 5）。mock provider 只允许 development/test；`VERIFICATION_SECRET` 必须是 64 位十六进制字符串，解析为 32 个随机字节后作为 HMAC 密钥，不能用字符种类猜测熵。production 配置 mock 会拒绝启动。`VERIFICATION_MOCK_CODE` 只允许 test 且须为 6 位数字。disabled 模式保留接口但发送返回 503，不回退为固定验证码。

Future：接入真实短信 provider 前须实现 IP 维度限流、手机号累计发送限额和全局费用熔断；当前版本不提供这些控制。

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

登录态使用 Cookie-based session。登录成功响应只返回版本化的用户摘要，不返回 bearer token 或 session secret；浏览器在后续请求中携带服务端设置的 session Cookie。登录 handler 必须将输入交给 `serializeLoginResponse`，注册 handler 必须使用独立的 `serializeRegistrationResponse`；两者都必须发送解析结果，不得只校验后发送仍可能携带 `token`、`sessionToken` 或 `refreshToken` 的原始对象。

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

`@panshi/contracts` 当前定义并导出：统一错误、分页元数据、用户角色、报名状态、公开内容模块、资源访问级别、公开站点响应、管理员与学员登录请求/响应、独立注册响应、验证码用途和请求、注册与密码重置请求、profile 响应和提交报名快照。

### 报名表配置接口

共享 `RegistrationFormSchema` 固定 `name`、`phone`、`email`、`organization`、`department`、`identityType`、`educationStage`、`majorResearchDirection` 八个核心字段；手机号字段始终 `readOnly: true`。动态问题仅接受 `short_text`、`long_text`、`single_choice`、`multiple_choice`，每题和每个选项均要求稳定 UUID，题目和附件 order 必须从零连续。附件是独立数组，默认种子为 UUID `00000000-0000-4000-8000-000000000001` 的非必填“个人简历／补充材料”，格式为 `pdf`、`docx`。

管理员接口均要求 `panshi_session` Cookie 和管理员角色；匿名请求返回 401，普通学员返回 403：

- `GET /api/v1/admin/registration-form/draft`：读取草稿、`revision`、`baseVersion` 和 `publishedVersionId`。
- `PUT /api/v1/admin/registration-form/draft`：请求 `{ "form": {...}, "expectedRevision": n }`；校验失败返回 422 `REGISTRATION_FORM_VALIDATION_FAILED`，字段位于 `error.details.fields`，revision 冲突返回 409 `REGISTRATION_FORM_CONFLICT`。
- `GET /api/v1/admin/registration-form/preview`：读取当前草稿供后台预览。
- `POST /api/v1/admin/registration-form/publish`：请求 `{ "expectedRevision": n }`，在事务中创建新不可变版本并更新草稿基线。
- `GET /api/v1/admin/registration-form/history`：按版本号倒序读取原始表单快照。

公共读取不返回任何学员私人值：`GET /api/v1/public/registration-form` 返回当前发布版本；尚未发布时返回 404 `REGISTRATION_FORM_NOT_FOUND`。`GET /api/v1/public/registration-forms/:id` 按 `formVersionId` 读取原始表单快照，供绑定应用或测试读取。

### 学员报名

- `GET /api/v1/me/application`：读取或初始化当前登录学员唯一报名，返回固定资料、当前表单版本、草稿答案、有效附件、状态时间线和补充要求占位；禁用账号返回 403 `ACCOUNT_DISABLED`。
- `PUT /api/v1/me/application/draft`：按 `expectedRevision` 保存资料、答案和附件引用。草稿可不完整，但类型、长度、选项和附件归属必须有效；冲突返回 409 `APPLICATION_REVISION_CONFLICT`。手机号由会话账号写入，不接收客户端覆盖。
- `POST /api/v1/me/application/submit`：按 `expectedRevision` 原子提交。报名窗口按 `Asia/Shanghai` 业务日期判断，开放日和截止日均包含全天。服务端在事务内复核报名窗口、账号状态、表单版本、全部必填项及附件状态，写不可变快照、状态历史和脱敏审计；提交后锁定，重复提交返回 409。

草稿在管理员发布新版表单后按稳定字段 ID 迁移到新版本，已有答案不删除，停用或移除字段 ID 通过 `retiredAnswerIds` 明示。停用附件项会在同一事务中解除草稿关联，但不隐藏或删除用户文件；这些文件通过 `unlinkedAttachments` 返回，用户仍可下载或主动删除。已提交报名永久绑定提交时的表单和附件元数据快照。审计仅记录 revision、答案数、附件数和表单版本，不记录答案、手机号或文件名。

附件接口如下。

### 受保护附件接口

以下接口使用既有 `panshi_session`，不建立第二套身份系统。匿名请求返回 401；文件不存在、已隐藏、已删除或当前普通用户不是所有者时统一返回 404 `FILE_NOT_AVAILABLE`，不泄露对象是否存在。已停用账号不能上传或管理文件。

- `POST /api/v1/files`：`multipart/form-data`，文件字段名为 `file`，同时提供 `purpose=registration_attachment`，可选 `attachmentSlot`。成功返回 201 和不含 storage key、物理路径、SHA-256 的文件摘要。
- `GET /api/v1/files/:id/download`：仅文件所有者及有效管理员可下载，返回 `Content-Disposition: attachment`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`。
- `PATCH /api/v1/files/:id/hide`：文件所有者或有效管理员隐藏文件，成功返回 204；隐藏后所有下载立即失效。
- `DELETE /api/v1/files/:id`：文件所有者或有效管理员删除文件。状态先进入 `deleting` 并立即停止下载，物理删除成功后进入 `deleted`；物理删除失败进入 `delete_failed`，返回 503 `FILE_DELETE_FAILED`，再次调用同一接口可重试。

附件一旦进入已提交或后续状态，隐藏和删除接口均返回 409 `FILE_LOCKED_BY_APPLICATION`；只读下载仍按本人或管理员权限判断。
报名提交、附件隐藏和附件删除统一按“先报名记录、后文件记录”的顺序加行锁；报名状态核对与文件隐藏／删除在同一数据库事务内完成，避免提交与文件操作并发时出现已提交附件消失。

上传仅允许 PDF 和 DOCX，稳定拒绝码包括 `FILE_REQUIRED`、`FILE_NAME_INVALID`、`FILE_EXTENSION_NOT_ALLOWED`、`FILE_MIME_MISMATCH`、`FILE_TOO_LARGE`、`FILE_CONTENT_INVALID`、`FILE_MULTIPART_INVALID`、`FILE_PURPOSE_INVALID`、`FILE_ATTACHMENT_SLOT_INVALID`、`FILE_UPLOAD_CONCURRENCY_LIMITED`、`FILE_UPLOAD_GLOBAL_RATE_LIMITED` 和 `FILE_UPLOAD_RATE_LIMITED`。错误响应不包含物理路径、文件内容或底层解析器消息。Task 13 绑定报名附件时必须同时验证文件处于 `active`、所有者是当前申请人、`purpose=registration_attachment`，且附件 `slot` 与提交所用表单快照一致；每个报名附件项只能绑定一个有效文件。

公开内容模块使用固定的后端内容 key：`basic`、`features`、`organizations`、`importantDates`、`schedule`、`contacts`、`travel`、`display`。这些 key 不是页面路由，不提供路由名称 alias。

公开站点聚合响应包含 `contentVersion`，以及 `basic`、`importantDates`、`contacts`、`display` 四个已发布 payload；`schedule` 保持独立，不混入该最小聚合。八个模块分别使用 `BasicContentSchema`、`FeaturesContentSchema`、`OrganizationsContentSchema`、`ImportantDatesContentSchema`、`ScheduleContentSchema`、`ContactsContentSchema`、`TravelContentSchema`、`DisplayContentSchema` 校验。公开 Web 客户端再次按共享响应契约解析 HTTP payload，不导入数据库代码。

公开响应的顶层和 `data` envelope 会容忍并剥离 v1 未知增量字段，但缺失必需字段、错误 `apiVersion` 或错误必需字段类型仍会被拒绝。公开内容 payload 保持按模块严格校验。内容日期必须是真实 Gregorian `YYYY-MM-DD`，`basic.dates.start` 不得晚于 `end`；日程共用同一日期校验。联系链接只允许不含凭据的 `https:`、合法邮箱的 `mailto:` 和合法号码的 `tel:`。

报名快照表示某次提交时的 `formVersion`、`submittedAt` 和 JSON-safe 答案副本。解析后的快照及其嵌套对象、数组均不可变。它不是可在线修改的表单定义；补充或再次提交应产生新的版本化快照，而不是改写既有快照。
