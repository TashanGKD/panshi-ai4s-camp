# CLI 安装与安全自举

## 前提与稳定入口

首版要求 Node.js 24 和 npm 11。安装器只写当前用户目录，不使用 `sudo`，也不修改 shell profile 或系统 `PATH`。

- Unix：安装目录为当前用户主目录下 `.local/share/panshi-camp-cli/<version>`，稳定入口为 `.local/bin/panshi-camp`。Agent 必须先用系统用户目录 API 解析主目录，再调用形如 `/Users/alice/.local/bin/panshi-camp` 的绝对路径。
- Windows：安装目录为 `%LOCALAPPDATA%\\panshi-camp-cli\\<version>`，稳定入口为 `%LOCALAPPDATA%\\panshi-camp-cli\\bin\\panshi-camp.cmd`。`%LOCALAPPDATA%` 只用于说明位置；Agent 必须先解析其绝对值，再调用完整的 `.cmd` 路径。

不要求把稳定入口加入 `PATH`。如果用户希望在自己的终端直接使用短命令，可以在安装完成后自行把稳定入口所在目录加入 `PATH`；Skill 不替用户修改。

## 安装流程

1. 解析当前 Skill 目录的绝对路径，记为 `<PANSHI_CAMP_SKILL_DIR>`，并无参数运行安装器：`node "<PANSHI_CAMP_SKILL_DIR>/scripts/install-cli.mjs"`。无参数运行安装器只验证 Skill 内嵌 manifest 并打印预览，零网络、零写入。
2. 读取预览中的 requiredVersion，作为当前 Skill 唯一要求的 CLI 版本。
3. 判断稳定入口是否存在；入口存在时，运行稳定入口的 --version 并与 `requiredVersion` 精确比较。
4. 版本一致则直接继续使用稳定入口，不展示安装确认，也不执行安装器的 `--yes`。
5. 不存在或版本不一致时，完整展示预览并询问用户是否按预览安装。泛化请求、此前确认或 Agent 自己的判断都不能代替本次确认。
6. 用户明确同意后运行 --yes：`node "<PANSHI_CAMP_SKILL_DIR>/scripts/install-cli.mjs" --yes`。未知参数、重复 `--yes` 和 `--yes=false` 都会被拒绝。
7. 安装完成后，使用对应平台的绝对稳定入口再次运行 `--version` 和 `--help`；生产调用继续显式使用 `--profile panshi --environment production`。

安装器只读取与脚本同属一个 Skill 的 `release-manifest.json`。它不接受命令行或环境变量传入的 URL、SHA 或远程 manifest，也不会从网页或 Agent 提示复制下载地址。

## 尚未发布或安装失败

Task 3 写入真实 `release-manifest.json` 之前，安装器会报告 `INSTALLER_NOT_PUBLISHED`（CLI 尚未发布），不联网、不写盘。不要猜测 Release 地址，不要自行改写 URL 或摘要。

摘要、大小、逐跳重定向主机、包名、版本、安装树清单或最终包内 `dist/main.js` 校验失败时，安装器会拒绝切换稳定入口并清理下载与临时安装目录。稳定入口直接指向已验证的包内入口，不依赖 npm `.bin` shim。npm 安装固定使用 `--ignore-scripts`，不会执行发行包生命周期脚本。已有同版本内容被修改、删除或增加，稳定入口非受管，路径经过符号链接／Windows reparse point，owner 不符，或 `panshi` profile 指向其他地址时，安装器均拒绝覆盖。

生产 profile 写入当前用户的 `.config/panshi-camp/config.json`：保留其他 profiles；同址重复安装幂等；同名异址拒绝。Unix 配置目录和文件权限分别为 `0700`、`0600`。

版本目录、稳定入口与配置按事务顺序切换；后续步骤失败时恢复安装前的入口和配置，并删除本次新建版本。Unix 会在关键写入和 rename 前后重检路径与当前 uid owner。相同 uid 仍可能在相邻系统调用之间制造极窄竞态；安装器不声称消除此内核级 TOCTOU，而是在检测到父路径、符号链接或 owner 变化时拒绝继续并尽力回滚。

## 平台验证边界

Unix 安装、符号链接逃逸、权限和清理测试可在 macOS/Linux 运行。Windows 路径使用 `win32` 语义，并通过可注入 reparse 属性测试；真实 junction 创建与拒绝测试只在 Windows CI 执行。macOS 上的跳过结果不代表真实 junction 已在本机验证。
