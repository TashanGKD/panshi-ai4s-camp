# CLI 发布检查清单

## 契约与文档

- [ ] 28 项 learner capability 在 Web、CLI 和 Skill 中全部通过 parity gate。
- [ ] `docs/cli.md` 命令清单与 capability registry 一致。
- [ ] `docs/api.md` 已记录 CLI bearer session、确认意图和报到二维码脱敏边界。

## 安全默认值

- [ ] 无参数和 `--help` 不读账号、不写文件、不访问生产环境。
- [ ] HTTP 只允许 loopback；生产调用必须使用 HTTPS profile 和显式 `--environment production`。
- [ ] token 仅进入操作系统钥匙串；钥匙串不可用时 fail closed，无明文回退。
- [ ] 密码、验证码、token、Cookie 和二维码原文不出现在 argv、普通日志、JSON 输出或审计记录中。
- [ ] 下载和二维码导出拒绝覆盖既有文件、符号链接父目录、变量未展开路径和受保护根目录。

## 分层验证

```bash
npm run typecheck
npm run lint
npm run build
npm run test:parity
npm test
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' npm run e2e:cli
STUDENT_AUTH_E2E=1 TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' E2E_VERIFICATION_CODE=123456 E2E_REGISTER_PHONE='+8613800000097' E2E_REGISTER_PASSWORD='Student-E2E-19!' E2E_RESET_PHONE='+8613800000096' E2E_RESET_PASSWORD='Reset-E2E-Old-19!' E2E_RESET_NEW_PASSWORD='Reset-E2E-New-19!' VERIFICATION_SECRET='1111111111111111111111111111111111111111111111111111111111111111' npm run e2e:student-auth
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' APPLICATION_E2E=1 E2E_VERIFICATION_CODE=123456 E2E_REGISTER_PHONE='+8613800000098' E2E_REGISTER_PASSWORD='Application-E2E-19!' VERIFICATION_SECRET='1111111111111111111111111111111111111111111111111111111111111111' npm run e2e:application
TEST_DATABASE_URL='postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test' npm run test:release
```

每层单独记录结果。任何一层未执行或失败时，不得宣称 CLI 已可发布。
