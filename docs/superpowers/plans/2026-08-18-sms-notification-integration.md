# SMS Notification Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将五个已审核通过的通知短信模板可靠接入报名提交和审核状态变更流程。

**Architecture:** 在现有报名和审核数据库事务中写入幂等 outbox，由独立 worker 领取并调用阿里云 SendSms。网关故障不回滚报名业务；明确未受理错误按分类重试或进入 dead letter，结果不确定错误不自动重发。

**Tech Stack:** TypeScript、Node.js、Drizzle ORM、PostgreSQL、Vitest、Alibaba Cloud SMS SDK、Docker Compose。

---

### Task 1: 定义 provider 与 worker 契约

**Files:**
- Create: `apps/api/src/modules/sms/notification.types.ts`
- Create: `apps/api/src/modules/sms/aliyun-notification-provider.ts`
- Create: `apps/api/tests/aliyun-notification-provider.test.ts`
- Create: `apps/api/tests/sms-notification-worker.test.ts`

- [ ] 先写失败测试：精确模板映射、合法手机号、阿里云 `Code=OK` 返回 BizId。
- [ ] 写拒绝测试：批量/国际格式手机号、未知事件、永久错误、限流错误、网络结果不确定错误。
- [ ] 运行定向测试并确认因实现缺失而失败。
- [ ] 实现 provider 接口、错误分类和最小 worker 调度逻辑。
- [ ] 运行定向测试并确认通过。

### Task 2: 增加 outbox 数据模型

**Files:**
- Create: `apps/api/drizzle/0024_sms_notification_outbox.sql`
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/modules/sms/notification.repository.ts`
- Create: `apps/api/tests/sms-notification-repository.integration.test.ts`
- Modify: `apps/api/tests/schema.test.ts`

- [ ] 先写失败的 schema 和 repository 集成测试：事件去重、合法状态约束、SKIP LOCKED 领取、陈旧锁回收。
- [ ] 运行定向测试并确认迁移/表缺失导致失败。
- [ ] 实现 SQL 迁移、Drizzle schema、事务入队和 worker repository。
- [ ] 运行迁移及 repository 测试并确认通过。

### Task 3: 接入报名与审核事务

**Files:**
- Modify: `apps/api/src/modules/registration/application.repository.ts`
- Modify: `apps/api/src/modules/registration/review.repository.ts`
- Modify: `apps/api/tests/application.integration.test.ts`
- Modify: `apps/api/tests/review-workflow.integration.test.ts`

- [ ] 先写失败测试：首次提交、重新提交、补充材料重提各入队；四种审核结果入队；`reviewing` 不入队。
- [ ] 运行定向测试并确认 outbox 断言失败。
- [ ] 在现有事务中调用统一入队函数，使用版本 ID 或状态历史 ID 组成幂等键。
- [ ] 运行报名和审核集成测试并确认业务状态与 outbox 同时提交。

### Task 4: 配置与生命周期

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/tests/health.test.ts`
- Modify: `apps/api/tests/aliyun-verification-provider.test.ts`
- Modify: `.env.example`
- Modify: `compose.prod.yaml`
- Modify: `docs/operations.md`

- [ ] 先写失败测试：安全默认关闭、启用时缺少任一配置即启动失败、worker 可停止且不重叠执行。
- [ ] 运行定向测试并确认缺少配置契约。
- [ ] 实现通知配置解析、provider/worker wiring 和 shutdown 清理。
- [ ] 更新生产 compose 与运维说明。
- [ ] 运行配置、生命周期和 provider 测试。

### Task 5: 全量验证与提交

**Files:**
- Verify: `apps/api/**`
- Verify: `compose.prod.yaml`
- Verify: `docs/operations.md`

- [ ] 运行 API 单元测试、集成测试、schema 测试、typecheck 和 build。
- [ ] 运行 `git diff --check`、敏感信息扫描和模板代码一致性检查。
- [ ] 确认没有执行真实 `SendSms` 测试。
- [ ] 分阶段提交设计、数据模型、业务接入和生产 wiring。

### Task 6: AUP 部署验证

**Files:**
- Modify remotely: `/home/aup/panshi-ai4s-camp/secrets/production.env`
- Use: `deploy/deploy-to-aup.sh`

- [ ] 以不打印密钥的方式写入 provider、签名和五个模板代码。
- [ ] 部署当前提交并执行生产迁移。
- [ ] 验证容器健康、公开页面、API health 和 outbox 表结构。
- [ ] 确认部署没有生成历史通知或发送测试短信。
