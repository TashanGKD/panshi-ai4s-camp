# 磐石实训营 CLI、Skill 与可复用 Agent 设计

日期：2026-08-18
状态：设计已确认，尚未实施

## 1. 目标

建设一套以 CLI 为完整业务客户端、以 Skill 为智能体操作说明、以 Claude Agent SDK 为官网 Agent 执行框架的能力体系。

用户即使从未打开网页，也应能够让本地 Codex、Claude Code 等智能体加载 Skill，通过 CLI：

- 获取网页端可获得的全部公开信息和本人有权访问的信息；
- 完成网页端允许该用户执行的全部业务操作；
- 在写操作前查看准确的变更预览并显式确认；
- 在网页、CLI 和官网 Agent 之间恢复同一账号下的业务状态与会话。

“等价”指业务能力等价，不要求 CLI 复刻网页像素布局。网页中的图片、地图、二维码和文件，CLI 应返回结构化说明、资源元数据，并提供受控下载或导出能力。

## 2. 已确认原则

1. 网站后台及业务数据库是会务信息、报名、审核和报到状态的唯一真源。
2. CLI 是完整客户端，不是少量快捷命令的集合。
3. Skill 不内嵌会变化的日程、联系人或报名状态，只描述如何调用 CLI。
4. 官网 Agent 是普通 Agent 框架加载同一领域 Skill 后形成的一个客户端。
5. 首版使用 TypeScript Claude Agent SDK，不另造 Agent 循环、工具编排和会话恢复框架。
6. 模型和运行参数由后台配置，网页只呈现对话界面。
7. 普通学员与工作人员使用同一 CLI 程序，但属于不同权限域并加载不同 Skill。
8. 权限最终由业务 API 校验；SDK 权限和 Skill 说明不能代替服务端授权。
9. Web—CLI—Skill 等价必须由可执行门禁保证，不能依赖人工同步。

## 3. 现有系统依据

当前后端已经提供以下真实能力：

- 公开内容、日程、报名表和机构名录挂载于 `/api/v1/public`；
- 本人报名挂载于 `/api/v1/me/application`，支持读取、保存草稿、重新开放和提交；
- 本人报到凭证挂载于 `/api/v1/me/check-in`；
- 附件挂载于 `/api/v1/files`，支持上传、下载、隐藏和删除；
- 资料挂载于 `/api/v1/resources`，根据匿名、登录和录取状态控制访问；
- 报名状态为 `draft`、`submitted`、`reviewing`、`needs_supplement`、`admitted`、`waitlisted`、`rejected`。

依据：

- `apps/api/src/app.ts:173-217`
- `apps/api/src/modules/registration/application.routes.ts:13-34`
- `apps/api/src/modules/check-in/check-in.routes.ts:12-33`
- `packages/contracts/src/registration.ts:326-334`

CLI 应使用现有共享契约，不重新定义报名字段和状态枚举。

## 4. 总体架构

```text
                         ┌─────────────────────────┐
                         │ 业务 API 与统一信息真源 │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ 共享 TypeScript Client  │
                         │ 认证/契约/错误/幂等/预览 │
                         └──────┬──────────┬───────┘
                                │          │
                    ┌───────────▼──┐   ┌───▼────────────────┐
                    │ 完整 CLI 客户端│   │ 官网 Agent 工具适配 │
                    └──────┬───────┘   └───┬────────────────┘
                           │               │
                 ┌─────────▼────────┐  ┌───▼────────────────┐
                 │ 本地 Agent + Skill│  │ Claude Agent SDK   │
                 └──────────────────┘  │ + 同一领域 Skill    │
                                       └────────────────────┘
```

共享 TypeScript Client 是唯一业务调用实现。CLI 调用 Client；官网 Agent 将同一 Client 包装成受控工具。官网 Agent 不通过任意 Shell 执行 CLI，以免引入命令解析、凭证暴露和子进程管理风险。

## 5. 交付顺序

1. 固定并补齐业务 API 契约；
2. 建立共享 TypeScript Client；
3. 完成 CLI、结构化输出和认证；
4. 编写学员 Skill，并在本地 Codex、Claude Code 中验证；
5. 建立 Web—CLI—Skill 等价门禁；
6. 使用 Claude Agent SDK 接入官网悬浮 Agent；
7. 在需要时增加工作人员 CLI 权限域与 Admin Skill。

## 6. 能力注册表

建立机器可读的统一能力注册表。每项能力至少包含：

```ts
type Capability = {
  id: string
  apiOperation: string
  webSurface: string[]
  cliCommand: string
  skillIndex: string[]
  roles: Array<'anonymous' | 'user' | 'admin'>
  effect: 'read' | 'write' | 'delete'
  confirmation: 'none' | 'single' | 'double'
  outputSchema: string
}
```

注册表描述能力对应关系，不重复 API 的请求和响应结构。具体数据结构继续来自 `@panshi/contracts`。

网页入口、CLI 命令和 Skill 索引都必须引用能力 ID。新增或删除业务能力时，三端必须在同一变更中完成同步。

## 7. CLI 首版范围

命令名暂定为 `panshi-camp`，最终名称可在实施前统一调整。

### 7.1 公开信息

- `info show`
- `schedule list [--date <date>] [--topic <topic>]`
- `content get <key>`
- `resources list`
- `resources download <id> --output <path>`
- `institutions search <query>`
- `application form`

### 7.2 账号认证

- `auth register`
- `auth login`
- `auth status`
- `auth logout`
- `auth password-reset`

注册、登录和密码重置使用交互式隐藏输入。密码和验证码不得作为命令行参数，不得写入历史记录、日志、Agent 上下文或 JSON 输出。

首版可复用现有手机号和密码接口，并将会话凭证保存到操作系统钥匙串。后续如果需要跨设备授权，可增加浏览器设备授权流程，但不作为首版阻塞项。

### 7.3 本人报名

- `application show`
- `application validate --input <file|stdin>`
- `application save --input <file|stdin>`
- `application reopen`
- `application submit`

CLI 动态读取当前公开报名表，不硬编码问题清单。Agent 应根据表单结构逐项询问缺失内容，并在执行前调用校验命令。

保存、重新开放和提交均携带 `expectedRevision`。发生版本冲突时不得覆盖，必须重新读取后再次生成预览。

### 7.4 附件

- `files upload <path>`
- `files download <id> --output <path>`
- `files hide <id>`
- `files delete <id>`

附件继续遵循现有 PDF、DOCX、JPG 类型限制及服务端安全校验。下载默认拒绝覆盖已有文件。删除采用二次确认，不提供无提示强制参数。

### 7.5 录取与报到

- `check-in show`

只有报名状态符合服务端规则时才返回二维码信息。CLI 可将二维码导出为终端可显示形式或图片文件，但不能自行生成或推断二维码载荷。

### 7.6 工作人员权限域

完整功能等价最终还包括内容发布、报名审核、批量处理、资料管理、账号管理、扫码查询、确认报到和审计查询。

现有身份契约只有 `user` 和 `admin` 两类角色，工作人员能力使用 `admin` 权限域。若以后需要细分审核员、内容编辑或报到人员，应先扩展服务端授权模型，再扩展 CLI，不在 Skill 中虚构新角色。

这些能力使用同一个 CLI 二进制，但必须：

- 由工作人员或管理员角色登录；
- 加载独立 Admin Skill；
- 在能力注册表中声明独立角色；
- 继续由后台服务端逐次鉴权；
- 不出现在普通学员 Skill 的工具说明中。

工作人员权限域可在学员 CLI 稳定后实施，但 Web—CLI 最终验收不能遗漏该域。

## 8. 输出契约

所有非交互命令支持 `--json`，并使用稳定结构：

```json
{
  "ok": true,
  "apiVersion": "v1",
  "capabilityId": "application.show",
  "data": {},
  "requestId": "..."
}
```

失败结构至少包含：

```json
{
  "ok": false,
  "code": "APPLICATION_REVISION_CONFLICT",
  "message": "报名信息已发生变化，请重新读取后再提交",
  "details": {},
  "requestId": "..."
}
```

Skill 依据 `code` 分支处理，不解析自然语言错误消息。至少区分：未登录、权限不足、输入无效、状态不允许、版本冲突、需要确认、确认过期、资源不存在和服务暂不可用。

## 9. 变更预览与确认

读取操作直接执行。写入和删除操作采用两阶段协议：

1. 第一次调用生成标准化变更预览；
2. 服务端返回短期 `confirmation_id`；
3. Agent 将预览完整展示给用户；
4. 用户明确确认；
5. 第二次调用携带 `confirmation_id` 执行；
6. 服务端返回业务结果和审计编号。

`confirmation_id` 必须绑定：

- 租户与用户；
- 能力 ID；
- 规范化参数摘要；
- 目标资源与 `expectedRevision`；
- 创建时间和失效时间；
- 单次使用状态。

任何参数、用户、资源版本或有效期不一致均拒绝执行。删除附件采用二次确认。

## 10. Skill 设计

### 10.1 学员 Skill

Skill 包含：

- 触发条件和能力边界；
- CLI 安装与登录检查；
- 能力 ID 到 CLI 命令的选择规则；
- 报名表逐项收集方法；
- 写操作预览与确认要求；
- 稳定错误码的处理方法；
- 常见任务示例和安全禁令。

Skill 不包含：

- 固定日程、联系人和嘉宾名单；
- 用户报名内容或审核状态；
- 密码、验证码和会话凭证；
- 复制的 API schema；
- 绕过确认或服务端权限的方法。

### 10.2 Admin Skill

Admin Skill 与学员 Skill 物理分离，只面向工作人员账号。它不得扩大后台账号本身的权限，也不得把内部审核信息暴露给普通会话。

## 11. 官网 Agent

官网 Agent 使用 TypeScript Claude Agent SDK：

- `permissionMode: "default"`；
- `canUseTool` 对接网页确认卡片；
- `disallowedTools` 明确禁用 Bash、文件写入和其他无关内置工具；
- 仅注册来自共享 Client 的受控业务工具；
- 使用 `persistSession`、`sessionId` 和 `resume` 支持连续会话；
- 多机部署时再接入外部 `SessionStore`；
- 匿名用户只能调用公开能力；登录后按当前网站身份调用本人能力。

`allowedTools` 只表示自动批准，不作为工具隐藏机制。业务权限仍在 API 层执行。

模型、最大轮次、预算、努力等级和启用工具由后台配置。产品边界不绑定模型，但 Claude Agent SDK 对非 Claude 模型的兼容性必须通过独立技术验证，不能在验证前作为生产承诺。

## 12. Web—CLI—Skill 等价门禁

实施 `web-cli-parity` 门禁：

1. 从能力注册表读取全部能力 ID；
2. 提取网页已注册能力 ID；
3. 提取 CLI 已注册命令及能力 ID；
4. 提取学员 Skill 与 Admin Skill 索引；
5. 输出缺失、重复和角色不一致的差异；
6. 任一差异存在时退出非零。

门禁接入 PR CI 和发布流程。门禁本身必须配套同名自测，至少验证：

- 删除一个 CLI 命令会失败；
- 新增网页能力但遗漏 Skill 会失败；
- 学员 Skill 错误引用管理员能力会失败；
- 同一能力三端确认等级不一致会失败；
- 正常完整注册时通过。

门禁只证明能力登记完整，不能替代端到端行为测试。

## 13. 安全边界

- CLI 默认连接本地或明确配置的环境，不得无参数默认操作生产环境。
- 用户凭证存操作系统钥匙串；配置文件只保存非敏感服务地址和账号提示。
- CLI 不接受明文密码参数，也不回显 Cookie、令牌、验证码或二维码原始载荷。
- 路径输入必须拒绝目录穿越、符号链接越界和默认覆盖。
- 上传在客户端预检后仍由服务端重新校验。
- 所有写操作使用幂等键、版本号和审计记录。
- Skill 与模型提示不能成为权限边界。
- 官网 Agent 不直接访问业务数据库。

## 14. 验收标准

### 14.1 学员功能等价

在不打开网页的情况下，使用本地 Codex 或 Claude Code 加载 Skill，可以完成：

- 查询全部公开会务信息；
- 注册、登录和恢复账号；
- 完整填写、校验、保存和提交报名；
- 上传及管理报名附件；
- 查看报名状态、时间线和补充要求；
- 获取本人有权访问的资料；
- 在录取后获取报到二维码和报到结果。

### 14.2 工作人员功能等价

工作人员 CLI 与 Admin Skill 完成后，应覆盖后台网页中该角色可执行的全部操作，并保持相同权限与状态机限制。

### 14.3 一致性与安全

- 能力等价门禁通过，且反例自测能够真实阻断漂移；
- 公开、学员、工作人员和管理员权限测试全部通过；
- 写操作未经确认不能执行；
- 确认编号不能跨用户、跨参数或跨版本重放；
- 密码、验证码和凭证不进入日志及 Agent 上下文；
- CLI 和网页对同一业务操作返回一致结果。

## 15. 非目标

首版不追求：

- CLI 复刻网页视觉布局；
- 自建通用 Agent 框架；
- 自建模型推理服务；
- 在 Skill 中固化会务内容；
- 用提示词替代服务端权限；
- 在学员 CLI 第一阶段同步完成全部后台管理命令。

## 16. 主要风险

1. 现有 API 使用浏览器 Cookie，CLI 安全存储和跨环境会话需要专门适配。
2. 两阶段确认协议尚未存在，需要新增服务端契约和持久化或签名机制。
3. 动态报名表较复杂，CLI 必须复用共享 schema 和条件显示逻辑。
4. 文件下载与二维码属于敏感输出，需要避免终端日志和 Agent 上下文泄露。
5. Claude Agent SDK 更新较快，应固定版本并以稳定内部接口隔离升级影响。
6. 非 Claude 模型通过兼容接口接入 Claude Agent SDK 的行为需单独验证。

## 17. 最终决策

本项目采用“统一业务 API + 共享 TypeScript Client + 完整 CLI + 分权限 Skill + Claude Agent SDK 官网客户端”的路线。

先证明本地 Agent 仅依靠 Skill 和 CLI 即可完成网页全部业务能力，再将同一 Client 与 Skill 接入官网 Agent。所有功能等价关系由能力注册表和自动门禁持续保障。
