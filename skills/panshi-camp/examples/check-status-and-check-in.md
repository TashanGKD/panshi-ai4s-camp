# 状态与报到示例

查询当前账号和报名信息均为只读：

```bash
panshi-camp --json auth status
panshi-camp --json application show
panshi-camp --json check-in show
```

用户明确给出一个新的本地文件路径后，才导出报到二维码：

```bash
panshi-camp --json check-in qr export --output ./check-in.gif
```

结果只报告导出文件，不转述二维码原始载荷。若用户要求删除附件，先运行 `files delete <id>` 获取服务端预览，展示完整预览后停止；用户明确同意并再次输入精确附件 ID，才执行第二次调用。
