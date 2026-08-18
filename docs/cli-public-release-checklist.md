# CLI 与 Skill 公开分发黑盒检查清单

本清单只验证本地发行夹具，不连接生产环境，不使用真实用户凭据，也不创建或发布远端 GitHub Release。

## 本地黑盒命令

```bash
node --test e2e/cli-public-install.test.mjs
```

测试从当前提交构建 `panshi-camp-cli-<version>.tgz`，在新的临时目录中创建空 `HOME`，再把仓库内的 `panshi-camp` Skill 安装到标准 Codex Skill 目录。发行附件通过进程内本地夹具提供，CLI 运行依赖从当前工作区复制；测试不得访问 GitHub、npm registry 或实训营生产服务。

## 必须通过的行为

- [ ] 标准目录中的 `SKILL.md` 可发现，且 front matter 名称为 `panshi-camp`。
- [ ] 安装器无参数时只输出预览，下载调用次数为零，`HOME` 文件树和内容摘要不变。
- [ ] 传入精确的 `--yes` 后安装本地构建的真实 `.tgz`，稳定入口的 `--version` 与发行 manifest 一致，`--help` 可运行。
- [ ] 摘要不一致时拒绝安装，并清除下载、安装、备份、交换和隔离临时节点。
- [ ] Unix 符号链接父目录被拒绝且链接目标不被写入；Windows 发行矩阵以真实 junction 执行对应测试。
- [ ] 同版本既有冲突被拒绝且原内容保留。
- [ ] 非受管稳定入口被拒绝且原入口保留。
- [ ] `panshi` 同名异址 profile 被拒绝且原配置保留。
- [ ] 所有拒绝路径均不残留安装事务临时节点。

## 平台记录

- Unix 运行应跳过 Windows junction 用例。
- Windows 运行应跳过 Unix symlink 用例，并实际执行 junction 用例。
- 任一非预期 skip、失败或生产网络访问都应阻止公开发布。

## 发布前分层记录

除本地黑盒命令外，发布负责人还应分别记录 CLI 单元测试、安装器单元测试、发行门禁、类型检查和 lint 的结果。未运行的层级必须明确标注“未运行”，不得用本黑盒结果代替其他验证层。
