# 磐石·科学智能实训营 CLI

CLI 与公开网站、学员个人中心使用同一套 `/api/v1` 服务和权限规则。无需打开浏览器，即可查询会务信息、注册账号、填写和提交报名、管理本人附件、下载获授权资料，以及在录取后导出报到二维码。CLI 不提供管理员操作。

## 环境与安装

- Node.js：`>=24 <25`
- npm：`>=11 <12`

在项目根目录执行：

```bash
npm install
npm run build -w @panshi/contracts
npm run build -w @panshi/camp-client
npm run build -w @panshi/cli
node apps/cli/dist/main.js --help
```

不带服务地址时，CLI 只访问本机 `http://127.0.0.1:3001`。生产环境必须在权限为 `0600` 的配置文件中声明 HTTPS profile，并同时显式传入 `--profile <名称> --environment production`。配置文件不得保存密码、验证码、Cookie 或 token。

```json
{
  "profiles": {
    "camp": {
      "baseUrl": "https://example.invalid",
      "phoneHint": "+8613800000000"
    }
  }
}
```

登录 token 仅存入操作系统钥匙串；钥匙串不可用时命令返回 `KEYCHAIN_UNAVAILABLE`，不会降级写入明文文件。密码和验证码只通过交互式隐藏输入或调用方注入的受保护输入提供，禁止使用命令行参数。

## 输出模式

- 默认模式面向人工阅读，确认写操作时会先显示服务端生成的预览。
- `--json` 面向 Codex 等智能体调用：stdout 始终只有一个 JSON 文档，进度和诊断进入 stderr。
- 成功结构为 `{ok:true,apiVersion:"v1",capabilityId,data,requestId}`；失败结构为 `{ok:false,code,message,details?,requestId}`。
- `check-in show` 永远脱敏二维码原文；`check-in qr export` 只返回输出路径和展示码。

## 写操作确认

JSON 模式下，首次调用写命令返回 `CONFIRMATION_REQUIRED`，`details` 中包含 `confirmationId`、`clientBinding`、`idempotencyKey`、过期时间和预览。调用方检查预览并获得用户明确同意后，使用原命令和以下三个参数再次执行：

```text
--confirmation-id <id> --client-binding <64位十六进制值> --idempotency-key <uuid>
```

确认意图一次性使用、短时有效，并绑定原始操作内容。附件在预览后发生变化、报名 revision 过期、确认被重放或过期时，服务端会拒绝执行。`files delete` 还要求人工模式再次输入目标附件编号。

## 命令清单

<!-- CLI_COMMAND_REFERENCE_START -->
| 能力 | 命令 | 登录 | 效果 | 确认 |
| --- | --- | --- | --- | --- |
| `public.site.show` | `info show` | 否 | 读取 | 无 |
| `public.content.show` | `content get <key>` | 否 | 读取 | 无 |
| `public.schedule.list` | `schedule list` | 否 | 读取 | 无 |
| `public.travel.show` | `travel show` | 否 | 读取 | 无 |
| `public.contacts.show` | `contacts show` | 否 | 读取 | 无 |
| `public.institutions.search` | `institutions search <query>` | 否 | 读取 | 无 |
| `public.registration_form.show` | `application form` | 否 | 读取 | 无 |
| `public.application_count.show` | `application-count show` | 否 | 读取 | 无 |
| `resource.list` | `resources list` | 视资料范围 | 读取 | 无 |
| `resource.download` | `resources download <id> --output <path>` | 视资料范围 | 本地写文件 | 无 |
| `auth.verification.send` | `auth verification send --phone <phone> --purpose register\|reset_password` | 否 | 写入 | 单次 |
| `auth.register` | `auth register --phone <phone>` | 否 | 写入 | 单次 |
| `auth.login` | `auth login --phone <phone>` | 否 | 写入 | 单次 |
| `auth.status` | `auth status` | 是 | 读取 | 无 |
| `auth.logout` | `auth logout` | 是 | 写入 | 单次 |
| `auth.password_reset` | `auth password reset --phone <phone>` | 否 | 写入 | 单次 |
| `account.password_change` | `account password change` | 是 | 写入 | 单次 |
| `application.show` | `application show` | 是 | 读取 | 无 |
| `application.validate` | `application validate --input <json-file\|->` | 是 | 本地校验 | 无 |
| `application.draft.save` | `application draft save --input <json-file\|->` | 是 | 写入 | 单次 |
| `application.reopen` | `application reopen` | 是 | 写入 | 单次 |
| `application.submit` | `application submit` | 是 | 写入 | 单次 |
| `file.upload` | `files upload <path> --slot <slot-id>` | 是 | 写入 | 单次 |
| `file.download` | `files download <id> --output <path>` | 是 | 本地写文件 | 无 |
| `file.hide` | `files hide <id>` | 是 | 写入 | 单次 |
| `file.delete` | `files delete <id>` | 是 | 删除 | 双重 |
| `check_in.show` | `check-in show` | 是 | 读取 | 无 |
| `check_in.qr.export` | `check-in qr export --output <path>` | 是且已录取 | 本地写文件 | 无 |
<!-- CLI_COMMAND_REFERENCE_END -->

## 常用错误码与退出码

命令成功退出码为 `0`，失败为 `1`。调用方应依据 JSON 的 `code` 分支，不应匹配中文提示文本。常见错误包括：`UNAUTHORIZED`、`FORBIDDEN`、`INPUT_INVALID`、`APPLICATION_REVISION_CONFLICT`、`CONFIRMATION_REQUIRED`、`CONFIRMATION_EXPIRED`、`CONFIRMATION_MISMATCH`、`CONFIRMATION_ALREADY_USED`、`RESOURCE_NOT_FOUND`、`KEYCHAIN_UNAVAILABLE`、`OUTPUT_EXISTS` 和 `SERVICE_UNAVAILABLE`。

## Agent Skill

项目内 Skill 位于 `skills/panshi-camp/`。执行 `panshi-camp skill path` 可查看源路径；执行 `panshi-camp skill install --agent codex|claude-code` 只显示安装预览，明确追加 `--yes` 后才安装。Skill 调用的仍是本 CLI，不复制身份、确认或权限逻辑。
