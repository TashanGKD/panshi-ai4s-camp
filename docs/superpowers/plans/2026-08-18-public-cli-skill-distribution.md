# 磐石实训营 CLI 与 Skill 公开分发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将仓库内 CLI 与 Skill 变成用户可从公开 GitHub 仓库安装、由 Skill 安全自举 CLI 的发行物。

**Architecture:** 使用 esbuild 将内部 contracts/client 依赖打入单一 CLI 入口，通过 GitHub Release 发布 npm `.tgz` 和校验 manifest。Skill 内置跨平台 Node 安装器，无参数只预览，确认后安装到用户目录并配置固定生产 profile。

**Tech Stack:** TypeScript、Node.js、esbuild、npm pack、Agent Skills CLI、GitHub Actions、Vitest、Node test runner。

---

### Task 1: 自包含 CLI 发行包

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/src/main.ts`
- Create: `apps/cli/scripts/build-package.mjs`
- Create: `apps/cli/src/version.test.ts`
- Create: `tests/cli-package.test.mjs`

- [ ] 先写测试，要求 `--version` 返回包版本，且 `npm pack --dry-run` 只包含运行文件、Skill 和公开依赖。
- [ ] 运行测试并确认因版本命令和发行构建缺失而失败。
- [ ] 使用 esbuild 将内部 workspace 包打入 CLI 入口；保留 `@napi-rs/keyring` 为公开运行依赖。
- [ ] 将 Skill 复制进发行包，生成可公开安装的 `panshi-camp-cli` 包。
- [ ] 运行单元测试和解包后的 `--help`、`--version` 冒烟测试。
- [ ] 提交 `feat(cli): build standalone release package`。

### Task 2: Skill 安全自举安装器

**Files:**
- Create: `skills/panshi-camp/scripts/install-cli.mjs`
- Create: `skills/panshi-camp/scripts/install-cli.test.mjs`
- Create: `skills/panshi-camp/references/installation.md`
- Modify: `skills/panshi-camp/SKILL.md`

- [ ] 先为摘要不一致、符号链接逃逸、既有目录冲突、无确认预览和非法 manifest 写五组失败测试。
- [ ] 运行测试并确认安装器尚不存在或拒绝逻辑缺失。
- [ ] 实现固定 Release manifest 下载、SHA-256 校验、临时安装、原子切换和失败清理。
- [ ] 实现 Unix 与 Windows 用户级入口，不使用 sudo，不覆盖不同内容。
- [ ] 在 Skill 中要求先检查 CLI，缺失时展示安装预览并获得明确确认。
- [ ] 提交 `feat(skill): bootstrap pinned camp cli safely`。

### Task 3: 生产 profile 与跨 Agent 安装说明

**Files:**
- Create: `skills/panshi-camp/release-manifest.json`
- Modify: `skills/panshi-camp/examples/register-and-apply.md`
- Modify: `skills/panshi-camp/examples/check-status-and-check-in.md`
- Modify: `docs/cli.md`
- Modify: `README.md`
- Modify: `tests/cli-docs.test.mjs`

- [ ] 先写文档门禁，要求安装命令、生产 profile 和 CLI 版本在 Skill、README、CLI 文档中一致。
- [ ] 运行门禁并确认缺失内容导致失败。
- [ ] 写入 Codex/Claude Code 标准一键安装命令及首次使用流程。
- [ ] 所有生产调用统一使用 `--profile panshi --environment production`；不改变 CLI 无参数的本地安全默认。
- [ ] 提交 `docs(cli): add public skill installation flow`。

### Task 4: 发行门禁与 GitHub Release

**Files:**
- Create: `scripts/build-cli-release.mjs`
- Create: `scripts/check-cli-release.mjs`
- Create: `scripts/check-cli-release.self-test.mjs`
- Create: `.github/workflows/cli-release.yml`
- Modify: `package.json`
- Test: `tests/cli-release.test.mjs`

- [ ] 先写门禁测试，构造版本漂移、内部依赖泄漏、绝对路径和错误摘要四类坏发行物。
- [ ] 运行测试并确认门禁能够被坏夹具触发。
- [ ] 生成 `.tgz`、SHA-256 和 manifest，发行工作流只在 `cli-v*` 标签触发。
- [ ] 发布前运行 CLI、parity、文档、发行物和解包冒烟测试；默认本地命令只生成 `dist-release/`，不发布、不打标签。
- [ ] 提交 `ci(cli): gate and publish release artifacts`。

### Task 5: 独立黑盒验证

**Files:**
- Create: `e2e/cli-public-install.test.mjs`
- Create: `docs/cli-public-release-checklist.md`

- [ ] 构建本地 Release 夹具并在空 HOME 中安装 Skill。
- [ ] 验证无 `--yes` 不发生下载或写入。
- [ ] 验证 CLI 安装、版本、帮助、生产公开查询和 Skill 发现。
- [ ] 验证摘要错误、符号链接和既有冲突均被拒绝且临时文件已清理。
- [ ] 由独立子智能体在第二个临时目录重复黑盒测试并审阅结果。
- [ ] 主智能体运行全套验证并提交 `test(cli): verify public skill bootstrap`。

