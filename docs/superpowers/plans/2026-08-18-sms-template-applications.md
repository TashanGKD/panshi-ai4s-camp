# 磐石实训营短信通知模板申请 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 使用已审核通过的“他山青年”签名，向阿里云提交五个已确认的国内通知短信模板，并留下不含密钥的可核验记录。

**Architecture:** 以已确认的模板设计文档为唯一文案真源；通过 AUP 服务器上的阿里云 CLI 和临时配置文件调用短信 API。先执行签名和模板重名预检，再以不少于 30 秒的间隔逐条申请；任一请求异常立即停止。全程不调用短信发送接口，退出时删除临时配置并关闭 CLI AI 模式。

**Tech Stack:** Aliyun CLI 3.4.11、Dysmsapi 2017-05-25、SSH、jq、Markdown 操作记录。

---

### Task 1: 申请前预检

**Files:**
- Read: `docs/superpowers/specs/2026-08-18-sms-notification-templates-design.md`
- Create: `docs/operations/sms-template-applications-2026-08-18.md`

1. 核对签名“他山青年”仍为审核通过状态。
2. 查询现有模板列表；若存在同名同文模板则复用并记录，若同名异文则停止。
3. 校验五个模板名称和正文唯一、数量为五，且正文不含变量、网址或电话号码。
4. 确认本次允许的 API 仅为 `GetSmsSign`、`QuerySmsTemplateList`、`CreateSmsTemplate` 和 `GetSmsTemplate`，不得调用 `SendSms` 或 `SendBatchSms`。

### Task 2: 逐条提交模板申请

**Files:**
- Read: `docs/superpowers/specs/2026-08-18-sms-notification-templates-design.md`
- Modify: `docs/operations/sms-template-applications-2026-08-18.md`

1. 使用临时 Aliyun CLI 配置加载 AUP 生产环境中的短信访问凭据，不打印、不持久化凭据。
2. 为五个模板统一设置 `TemplateType=1`、`RelatedSignName=他山青年` 和 `ApplySceneContent=https://panshi-ai4s.tashan.chat/`。
3. 按确认顺序逐条调用 `CreateSmsTemplate`，相邻申请间隔不少于 30 秒。
4. 每次响应必须满足 `Code=OK`，且含有模板代码和工单号；否则停止后续申请。

### Task 3: 查询状态并留档

**Files:**
- Modify: `docs/operations/sms-template-applications-2026-08-18.md`

1. 对每个返回的模板代码调用 `GetSmsTemplate`。
2. 核对模板名称、正文、类型、关联签名和申请场景与设计文档一致。
3. 记录模板代码、工单号、当前审核状态和查询时间，不记录任何凭据。
4. 关闭 Aliyun CLI AI 模式并删除临时配置目录。

### Task 4: 最终验证

**Files:**
- Read: `docs/operations/sms-template-applications-2026-08-18.md`

1. 确认五个模板均已提交或已存在且完全一致。
2. 确认五个模板均可通过 `GetSmsTemplate` 查询。
3. 确认操作记录不含 AccessKey、手机号或其他敏感信息。
4. 明确区分“申请已提交”和“模板已审核通过”，不得把审核中表述为已通过。
