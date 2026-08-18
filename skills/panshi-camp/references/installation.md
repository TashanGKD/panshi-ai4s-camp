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

摘要、大小、逐跳重定向主机、包名、版本、安装树清单或最终包内 `dist/main.js` 校验失败时，安装器会拒绝切换稳定入口并清理下载与临时安装目录。可信 manifest 的 `packageTreeSha256` 只覆盖发行 tarball 中的 `panshi-camp-cli` 包目录，不覆盖 npm 安装的公共、平台相关依赖。规范为：递归读取普通文件，拒绝符号链接及其他节点；相对路径统一使用 `/`，按完整路径的 UTF-8 字节升序排列；每项严格编码为 `{"path":<路径>,"size":<字节数>,"sha256":<文件内容的小写 SHA-256>}`，对这些对象组成的无空白 JSON 数组的 UTF-8 字节再计算小写 SHA-256；目录和 mode 不进入摘要。Task 4 发行门禁必须直接导入 `install-cli.mjs` 导出的 `computePackageTreeSha256(packageRoot)`，避免复制算法。安装器在首次安装、同版本复用和成功返回前都直接重算真实 CLI 包目录摘要并与可信 manifest 比较；本地 marker 只是辅助受管状态记录，不是信任根，同时伪造包树和 marker 仍会被拒绝。稳定入口直接指向已验证的包内入口，不依赖 npm `.bin` shim。npm 安装固定使用 `--ignore-scripts`，不会执行发行包生命周期脚本。已有同版本 CLI 包内容被修改、删除或增加，稳定入口非受管，路径经过符号链接／Windows reparse point，owner 不符，或 `panshi` profile 指向其他地址时，安装器均拒绝覆盖。

生产 profile 写入当前用户的 `.config/panshi-camp/config.json`：保留其他 profiles；同址重复安装幂等；同名异址拒绝。Unix 配置目录和文件权限分别为 `0700`、`0600`。

版本目录、稳定入口与配置按事务顺序切换；后续步骤失败时恢复安装前的入口和配置，并仅在路径仍对应本事务记录的同一 `dev`＋`ino` 目录时删除本次新建版本及 staging；身份不可用时 fail-closed，身份已变化时保留 replacement，且不追踪或删除被移动事务目录的新位置。安装器只删除仍为空的本次新建根目录，已有目录及其权限不变。配置切换后、成功返回前，安装器最后复检版本根不是符号链接且 owner 正确、CLI 包可信摘要、package metadata，以及稳定入口的真实目标；Unix 要求入口 `realpath` 精确等于预期 `dist/main.js`，Windows 要求 cmd 内容精确且目标仍存在并通过摘要。状态确认后的备份删除仅为 best-effort cleanup；删除失败可以留下安全备份，但不会反向触发 rollback。

安装器防御检查期间的父路径或版本根 swap，并在最终状态再次复检。相同 uid 仍可能在相邻系统调用之间制造极窄竞态；检测到变化时会拒绝继续并尽力回滚。威胁边界止于安装器返回：它不声称能阻止同一用户在安装器返回后主动改写自己的文件。

## 平台验证边界

Unix 安装、符号链接逃逸、权限和清理测试可在 macOS/Linux 运行。Windows 路径使用 `win32` 语义，并通过可注入 reparse 属性测试；真实 junction 创建与拒绝探针已写入但当前跳过。Task 4 将加入 Windows CI；加入前未验证。macOS 上的跳过结果不代表真实 junction 已在本机验证。
