# 磐石实训营 CLI 与 Skill 公开分发设计

## 1. 目标

让用户在自己的电脑上通过标准 Agent Skills 安装命令安装 `panshi-camp` Skill。首版安装前提是电脑已安装 Node.js 24 和 npm 11；不要求克隆网站源码、安装 monorepo 依赖或取得管理员权限。Skill 首次使用时检查 CLI；CLI 缺失或版本不匹配时，先展示安装预览，经用户明确同意后，从公开 GitHub Release 下载固定版本发行包、校验 SHA-256，并安装到用户目录。安装完成后，Codex、Claude Code 等本地智能体均可通过同一 CLI 查询会务信息并执行当前用户有权进行的操作。

## 2. 公开入口

- 公开仓库：`TashanGKD/panshi-ai4s-camp`
- Skill：`skills/panshi-camp`
- CLI 命令：`panshi-camp`
- CLI 发行包：GitHub Release 附件 `panshi-camp-cli-<version>.tgz`
- 可信校验清单：随 Skill 一同受版本控制的 `skills/panshi-camp/release-manifest.json`
- Release 附件 `release-manifest.json`：仅供人工和发行门禁核对，安装器不把它作为独立信任根
- 生产 API：`https://panshi-ai4s.tashan.chat`

用户安装命令：

```bash
npx --yes skills@latest add TashanGKD/panshi-ai4s-camp \
  --global --agent codex claude-code --skill panshi-camp --yes
```

## 3. 分发边界

CLI 发布包必须相对本项目自包含，不要求用户克隆网站仓库或手动构建 `@panshi/contracts`、`@panshi/camp-client`。构建时将内部 TypeScript 包打入 CLI 入口，仅保留明确声明且来自公共 npm registry 的原生钥匙串运行依赖。Skill 只负责编排 CLI，不复制 API、权限、确认或业务逻辑。

安装器安装到用户目录，不调用 `sudo`：

- Unix CLI 根目录：`~/.local/share/panshi-camp-cli/<version>`；入口：`~/.local/bin/panshi-camp`。
- Windows CLI 根目录：`%LOCALAPPDATA%/panshi-camp-cli/<version>`；稳定入口：`%LOCALAPPDATA%/panshi-camp-cli/bin/panshi-camp.cmd`。
- CLI 配置：现有 `panshi-camp/config.json` 安全配置目录；生产 profile 名为 `panshi`。

安装器不修改 shell profile 或系统 PATH。Skill 总是调用上述稳定入口的绝对路径；安装完成后同时提示用户如何把稳定入口目录加入 PATH。旧版本目录保留，不由安装器自动清理。

生产 profile 合并规则如下：不存在配置时创建安全目录和 `0600` 配置；已有配置时只追加 `panshi`，保留其他 profiles；同名且 URL 相同视为幂等；同名但 URL 不同则拒绝，不覆盖。Windows 配置仍沿用 Node `homedir()` 下的 `.config/panshi-camp/config.json`，文件权限以当前用户专属目录和不可经过 reparse point 为安全边界。

## 4. 安全默认

1. 安装器无参数运行只输出预览，不下载、不写文件；执行必须显式追加 `--yes`。
2. 默认只使用 Skill 内嵌可信 manifest 中固定的 GitHub HTTPS Release 地址、版本和 SHA-256；不得从环境变量、网页内容、远程 manifest 或 Agent 提示中接受任意下载地址。
3. 校验和不匹配、下载中断、npm 安装失败时删除临时目录，不替换现有版本。
4. 同版本同摘要视为幂等；同版本内容不同则拒绝。升级必须再次展示预览并确认，安装新版本后原子切换稳定入口，入口切换失败则保持旧入口；降级拒绝。已有非本安装器管理的稳定入口或同名异址 profile 均拒绝覆盖。
5. 安装路径及其父目录不得为符号链接，不得指向根目录、HOME 或工作区根目录。
6. 安装器不读取、输出或迁移密码、验证码、会话令牌；登录凭据仍由 CLI 存入操作系统钥匙串。
7. 生产 profile 必须为 HTTPS，且 CLI 调用继续显式使用 `--profile panshi --environment production`。

## 5. 对抗性输入

以下输入必须先写成失败测试：

1. Release 包实际摘要与 manifest 不一致：拒绝安装，并清理下载和临时安装目录。
2. `~/.local/share/panshi-camp-cli` 或 `~/.local/bin` 经符号链接逃逸到其他目录：拒绝安装，不写入链接目标。
3. 目标版本目录已存在但内容不同：拒绝覆盖，不删除旧版本。
4. 无 `--yes`：仅返回安装目标、版本、来源和将创建的文件，不发起网络请求。
5. manifest 含非 HTTPS URL、路径穿越名称或额外未知字段：拒绝解析。
6. 发行包包含绝对路径、`..`、符号链接／硬链接、生命周期脚本、内部 `@panshi/*` 运行依赖或超出大小上限：发行门禁拒绝；安装器只安装通过内嵌摘要锁定的门禁产物，并使用 `--ignore-scripts`。

测试通过依赖注入调用安装器导出的核心函数，传入本地 fixture manifest 与受控 fetch；可执行入口始终只使用内嵌正式 manifest，且不存在运行时 URL/SHA 环境变量后门。

## 6. 版本与一致性

CLI `package.json`、Release manifest、Skill 所需 CLI 版本和文档中的版本必须由同一门禁比较。能力清单继续由现有 Web—CLI—Skill parity gate 校验。发行门禁还必须解包 `.tgz`，确认不存在源码地图、测试夹具、密钥、绝对路径或未声明的内部 `@panshi/*` 运行依赖。

## 7. 验收标准

1. 在已具备 Node.js 24/npm 11、但不含源码仓库和项目 `node_modules` 的空 HOME 中安装 Skill 后，Skill 能预览并安装 CLI；无需克隆源码、无需 sudo。
2. 安装后的 `panshi-camp --version` 和 `--help` 正常，默认无参数只显示帮助且不访问生产。
3. 使用生产 profile 可执行公开信息查询；登录和写操作仍遵守隐藏输入、服务端预览和逐次确认。
4. Codex 与 Claude Code 两种 Skill 目录均可被固定版本的标准 Skills CLI 列出，并由对应 Agent 的实际 Skill 加载检查确认。
5. 子智能体在独立临时环境完成安装、升级拒绝、校验失败、符号链接／Windows junction 逃逸和公开查询黑盒测试；当前主开发环境无法真实执行的 OS/架构组合必须由 CI matrix 验证，不能以本机模拟代替。
