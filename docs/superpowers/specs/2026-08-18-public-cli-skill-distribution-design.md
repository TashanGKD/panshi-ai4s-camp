# 磐石实训营 CLI 与 Skill 公开分发设计

## 1. 目标

让用户在自己的电脑上通过标准 Agent Skills 安装命令安装 `panshi-camp` Skill。Skill 首次使用时检查 CLI；CLI 缺失或版本不匹配时，先展示安装预览，经用户明确同意后，从公开 GitHub Release 下载固定版本发行包、校验 SHA-256，并安装到用户目录。安装完成后，Codex、Claude Code 等本地智能体均可通过同一 CLI 查询会务信息并执行当前用户有权进行的操作。

## 2. 公开入口

- 公开仓库：`TashanGKD/panshi-ai4s-camp`
- Skill：`skills/panshi-camp`
- CLI 命令：`panshi-camp`
- CLI 发行包：GitHub Release 附件 `panshi-camp-cli-<version>.tgz`
- 校验清单：GitHub Release 附件 `release-manifest.json`
- 生产 API：`https://panshi-ai4s.tashan.chat`

用户安装命令：

```bash
npx --yes skills@latest add TashanGKD/panshi-ai4s-camp \
  --global --agent codex claude-code --skill panshi-camp --yes
```

## 3. 分发边界

CLI 发布包必须是自包含运行包，不要求用户克隆网站仓库或手动构建 `@panshi/contracts`、`@panshi/camp-client`。构建时将内部 TypeScript 包打入 CLI 入口，仅保留公开 npm 依赖。Skill 只负责编排 CLI，不复制 API、权限、确认或业务逻辑。

安装器安装到用户目录，不调用 `sudo`：

- Unix CLI 根目录：`~/.local/share/panshi-camp-cli/<version>`；入口：`~/.local/bin/panshi-camp`。
- Windows CLI 根目录：`%LOCALAPPDATA%/panshi-camp-cli/<version>`；入口：同一根目录下的 `bin/panshi-camp.cmd`。
- CLI 配置：现有 `panshi-camp/config.json` 安全配置目录；生产 profile 名为 `panshi`。

## 4. 安全默认

1. 安装器无参数运行只输出预览，不下载、不写文件；执行必须显式追加 `--yes`。
2. 默认只使用仓库内固定的 HTTPS Release 地址和固定 SHA-256；不得从环境变量、网页内容或 Agent 提示中接受任意下载地址。
3. 校验和不匹配、下载中断、npm 安装失败时删除临时目录，不替换现有版本。
4. 不覆盖已有不同版本或用户配置；升级必须再次展示预览并确认。
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

## 6. 版本与一致性

CLI `package.json`、Release manifest、Skill 所需 CLI 版本和文档中的版本必须由同一门禁比较。能力清单继续由现有 Web—CLI—Skill parity gate 校验。发行门禁还必须解包 `.tgz`，确认不存在源码地图、测试夹具、密钥、绝对路径或未声明的内部 `@panshi/*` 运行依赖。

## 7. 验收标准

1. 在空 HOME 中安装 Skill 后，Skill 能预览并安装 CLI；无需克隆源码、无需 sudo。
2. 安装后的 `panshi-camp --version` 和 `--help` 正常，默认无参数只显示帮助且不访问生产。
3. 使用生产 profile 可执行公开信息查询；登录和写操作仍遵守隐藏输入、服务端预览和逐次确认。
4. Codex 与 Claude Code 两种 Skill 目录均可被标准 Skills CLI 发现。
5. 子智能体在独立临时环境完成安装、升级拒绝、校验失败、符号链接逃逸和公开查询黑盒测试。

