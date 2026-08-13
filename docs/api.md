# API 契约边界

本文冻结磐石 AI4S 实训营的共享 API 契约，供后续服务端与客户端实现共同遵循。当前阶段只提供 `@panshi/contracts` 中的 Zod schema 和类型；下述路由是规划中的边界分组，不代表对应 endpoint 已实现或可访问。

## API 范围

本 API 只服务当前这一场活动，是 single-event API。契约不包含 `eventId`、tenant、edition，也不提供多租户或多活动抽象。

规划中的 `/api/v1` 边界分为：

- `/api/v1/public`：无需登录的站点内容与公开资源。
- `/api/v1/auth`：登录、退出和 Cookie session 生命周期。
- `/api/v1/me`：当前用户、报名快照和按登录或录取状态开放的资源。
- `/api/v1/admin`：统一管理员角色使用的内容、报名审核和资源管理能力。

具体方法、子路径、请求体与成功响应只有在后续 endpoint 实现并补充契约后才可视为可用接口。本阶段没有实现 API endpoint。

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

## Session 与身份

登录态使用 Cookie-based session。登录成功响应只返回版本化的用户摘要，不返回 bearer token 或 session secret；浏览器在后续请求中携带服务端设置的 session Cookie。Cookie 的名称、有效期以及 `Secure`、`HttpOnly`、`SameSite` 等部署参数由后续身份实现确定，不属于当前共享响应契约。

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

报名快照表示某次提交时的 `formVersion`、`submittedAt` 和答案副本。它是不可变的提交记录语义，不是可在线修改的表单定义；补充或再次提交应产生新的版本化快照，而不是改写既有快照。
