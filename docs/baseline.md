# 质量基线

## 既有 `homepage-v2`

- 前端 production build 通过。
- lint 当前有 36 errors 和 4 warnings。

这是已接受的既有基线，属于旧项目技术债，不在本任务范围内。

## 新项目 `panshi-ai4s-camp`

新项目不继承上述 lint 豁免。其工作区结构测试、TypeScript 检查和 ESLint 检查必须保持通过；后续新增代码也必须满足同一门禁。

## 依赖审计基线

- `npm audit --omit=dev` 通过，production dependencies 当前无已知漏洞。
- 完整 `npm audit` 当前报告 4 个 moderate，均位于 `drizzle-kit` 的开发依赖链（`@esbuild-kit/core-utils`、`@esbuild-kit/esm-loader` 和 `esbuild`）。该问题不通过强制不兼容升级处理，继续跟踪并在 `drizzle-kit` 提供兼容升级时更新。
