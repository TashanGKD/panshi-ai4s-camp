# 磐石实训营报名短信通知接入设计

## 1. 目标与范围

将已经审核通过的五个阿里云通知短信模板接入实训营报名流程：

| 业务事件 | 模板代码 |
| --- | --- |
| 报名首次提交、修改后重新提交、补充材料后重新提交 | `SMS_511835186` |
| 管理员要求补充材料 | `SMS_511725181` |
| 管理员审核通过 | `SMS_511895168` |
| 管理员设置为候补 | `SMS_511915194` |
| 管理员审核未通过 | `SMS_511645162` |

统一使用短信签名“他山青年”。本次只接入未来发生的报名和审核事件，不补发历史状态短信，不发送测试短信，也不把网关受理结果表述为运营商最终送达。

## 2. 现有代码契约

- 学员提交由 `apps/api/src/modules/registration/application.repository.ts:220` 开始的数据库事务完成；该事务会在 `:275` 生成唯一报名版本，并在 `:277-280` 更新状态、写入状态历史和审计日志。
- 管理员审核由 `apps/api/src/modules/registration/review.repository.ts:49` 的事务函数完成；合法状态迁移定义在 `:9-12`，状态更新、历史和审计写入位于 `:61-80`。
- 真实状态枚举为 `draft`、`submitted`、`reviewing`、`needs_supplement`、`admitted`、`waitlisted`、`rejected`，数据库约束位于 `apps/api/src/db/schema.ts:193-219`。
- 阿里云 SDK 和 AK/SK 配置已经用于验证码 provider，读取契约位于 `apps/api/src/config/env.ts:73-111`，发送适配器位于 `apps/api/src/modules/identity/aliyun-verification-provider.ts:49-77`。

## 3. 架构

采用“业务事务内写 outbox，后台 worker 异步发送”的模块化单体方案。

1. 报名提交或审核状态变更时，在同一数据库事务中写入一条短信通知 outbox 记录。
2. outbox 使用不可重复的 `event_key`：报名提交以报名版本 ID 去重，审核通知以状态历史 ID 去重。
3. worker 定时领取待发记录，按事件类型映射到固定模板代码，通过阿里云 `SendSms` 发送。
4. 阿里云返回 `Code=OK` 时只记录为“网关已受理”，同时保存 `BizId`；不宣称短信已送达。
5. 明确未受理且属于限流或系统繁忙的响应进入延迟重试；手机号、签名、模板等永久错误进入 dead letter。
6. 网络超时或连接中断属于“是否受理未知”，不自动重试，避免 `SendSms` 非幂等导致重复短信。

## 4. 数据模型

新增 `sms_notification_outbox`：

- `event_key`：业务幂等键，唯一；
- `event_type`：五类通知事件之一；
- `application_id`、`user_id`：关联报名和用户；
- `phone_normalized`：入队时的手机号快照；
- `status`：`pending`、`processing`、`retry_wait`、`accepted`、`dead_letter`；
- `attempts`、`available_at`、`locked_at`：领取和重试控制；
- `biz_id`、`provider_request_id`：阿里云网关受理凭据；
- `last_error_code`：失败分类代码；
- `created_at`、`updated_at`、`accepted_at`：审计时间。

数据库约束确保状态、事件类型、手机号格式、尝试次数及成功/失败字段之间一致。worker 使用行锁和 `SKIP LOCKED` 领取记录，避免多个 API 实例重复处理同一行；陈旧的 `processing` 锁可以被重新领取。

## 5. 配置与安全默认值

新增独立于验证码的通知配置：

- `SMS_NOTIFICATION_PROVIDER=disabled|aliyun`，默认 `disabled`；
- `ALIYUN_NOTIFICATION_SMS_SIGN_NAME`；
- 五个 `ALIYUN_NOTIFICATION_SMS_TEMPLATE_*`；
- worker 轮询、批量、最大尝试次数和陈旧锁时间。

只有 `SMS_NOTIFICATION_PROVIDER=aliyun` 时才强制要求 AK/SK、签名和五个模板代码完整。生产环境不允许 mock 通知 provider。代码不打印 AK/SK、手机号或完整 provider 响应；日志只记录 outbox ID、事件类型和错误分类。

## 6. 对抗性输入与失败边界

在实现前用失败测试锁定以下输入：

1. `13800138000,13900139000`、`+8613800138000` 或含空白的手机号必须拒绝，防止单个通知被解释为批量收件人。
2. 未知事件类型或缺失模板映射必须进入 dead letter，不得退回默认模板。
3. 同一 `event_key` 重复入队必须保持一条记录，不得重复发送。
4. 阿里云明确返回限流时可以延迟重试；明确永久错误进入 dead letter；连接超时等结果不确定错误不得自动重发。
5. worker 中途退出后，只有超过陈旧锁阈值的 `processing` 记录可以再次领取。

## 7. 验收标准

- 首次提交、重新提交和补充材料重新提交各生成一条报名提交通知事件，并以不同报名版本去重。
- 单条和批量审核均在目标状态为 `needs_supplement`、`admitted`、`waitlisted` 或 `rejected` 时可靠入队。
- `reviewing` 等没有对应模板的状态不入队。
- provider 失败不回滚已经提交的报名或审核状态；outbox 保留可审计状态。
- 本地单元测试、数据库集成测试、迁移测试、类型检查和构建通过。
- AUP 生产配置启用通知 provider 后，服务健康，五个模板代码与本设计一致，且部署过程不触发历史补发或测试短信。
