# 状态与报到示例

所需 CLI 版本：`0.1.13`。首次使用先安装公开 Skill（Node.js 24、npm 11；无需克隆源码或 sudo）：

```bash
npx --yes skills@latest add TashanGKD/panshi-ai4s-camp --global --agent codex claude-code --skill panshi-camp --yes
```

Skill 会先预览 CLI 安装，用户明确同意后才安装。所有生产调用显式使用 `--profile panshi --environment production`；无参数 CLI 保持本地安全默认。

查询当前账号和报名信息均为只读：

```bash
panshi-camp --profile panshi --environment production --json auth status
panshi-camp --profile panshi --environment production --json application show
panshi-camp --profile panshi --environment production --json check-in show
```

用户明确给出一个新的本地文件路径后，才导出报到二维码：

```bash
panshi-camp --profile panshi --environment production --json check-in qr export --output ./check-in.gif
```

结果只报告导出文件，不转述二维码原始载荷。若用户要求删除附件，先运行 `files delete <id>` 获取服务端预览，展示完整预览后停止；用户明确同意并再次输入精确附件 ID，才执行第二次调用。
