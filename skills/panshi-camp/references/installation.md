# CLI 安装与安全自举

## 前提与稳定入口

首版要求 Node.js 24 和 npm 11。安装器只写当前用户目录，不使用 `sudo`，也不修改 shell profile 或系统 `PATH`。

- Unix：安装目录为当前用户主目录下 `.local/share/panshi-camp-cli/<version>`，稳定入口为 `.local/bin/panshi-camp`。Agent 必须先用系统用户目录 API 解析主目录，再调用形如 `/Users/alice/.local/bin/panshi-camp` 的绝对路径。
- Windows：安装目录为 `%LOCALAPPDATA%\\panshi-camp-cli\\<version>`，稳定入口为 `%LOCALAPPDATA%\\panshi-camp-cli\\bin\\panshi-camp.cmd`。`%LOCALAPPDATA%` 只用于说明位置；Agent 必须先解析其绝对值，再调用完整的 `.cmd` 路径。

不要求把稳定入口加入 `PATH`。如果用户希望在自己的终端直接使用短命令，可以在安装完成后自行把稳定入口所在目录加入 `PATH`；Skill 不替用户修改。

## 安装流程

1. 解析当前 Skill 目录的绝对路径，记为 `<PANSHI_CAMP_SKILL_DIR>`。
2. 无参数运行 `node "<PANSHI_CAMP_SKILL_DIR>/scripts/install-cli.mjs"`。这一步只验证 Skill 内嵌 manifest 并打印版本、来源、安装位置和将创建的文件；无参数只打印预览，零网络、零写入。
3. 向用户完整展示本次预览并询问是否执行。泛化请求、此前确认或 Agent 自己的判断都不能代替这次确认。
4. 只有用户看过预览并明确同意后，运行 `node "<PANSHI_CAMP_SKILL_DIR>/scripts/install-cli.mjs" --yes`。未知参数、重复 `--yes` 和 `--yes=false` 都会被拒绝。
5. 安装完成后，使用对应平台的绝对稳定入口运行 `--version` 和 `--help`；生产调用继续显式使用 `--profile panshi --environment production`。

安装器只读取与脚本同属一个 Skill 的 `release-manifest.json`。它不接受命令行或环境变量传入的 URL、SHA 或远程 manifest，也不会从网页或 Agent 提示复制下载地址。

## 尚未发布或安装失败

Task 3 写入真实 `release-manifest.json` 之前，安装器会报告 `INSTALLER_NOT_PUBLISHED`（CLI 尚未发布），不联网、不写盘。不要猜测 Release 地址，不要自行改写 URL 或摘要。

摘要、大小、重定向主机、包名、版本或 bin 校验失败时，安装器会拒绝切换稳定入口并清理下载与临时安装目录。npm 安装固定使用 `--ignore-scripts`，不会执行发行包生命周期脚本。已有同版本内容不同、稳定入口非受管、路径经过符号链接／Windows reparse point、或 `panshi` profile 指向其他地址时，安装器均拒绝覆盖。

生产 profile 写入当前用户的 `.config/panshi-camp/config.json`：保留其他 profiles；同址重复安装幂等；同名异址拒绝。Unix 配置目录和文件权限分别为 `0700`、`0600`。

## 平台验证边界

Unix 安装、符号链接逃逸、权限和清理测试可在 macOS/Linux 运行。Windows 路径使用 `win32` 语义，并通过可注入 reparse 属性测试；真实 junction 创建与拒绝测试只在 Windows CI 执行。macOS 上的跳过结果不代表真实 junction 已在本机验证。
