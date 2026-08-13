# Visual source alignment

The test-only `legacyReference` in `visual.spec.ts` copies the common values from `frontend/src/styles/conferences.css` and `frontend/src/styles/App.css`: the Banner gradient, typography, 1200px container, navigation, 21px heading, and 4px marker. It is not imported by the web runtime.

The independent shell intentionally omits the legacy fixed generic header and “返回会议”. Therefore its Banner begins at the page top and the sticky event navigation uses `top: 0` instead of the legacy `top: 72px`. No color, type size, line height, marker, border, radius, or shadow is masked.

Normal comparison:

```bash
npx playwright test e2e/visual.spec.ts
```

Explicit baseline update only:

```bash
npm run visual:update
```

Pixel comparison uses `maxDiffPixels: 0`; there is no nonzero tolerance.

The first baseline run found that `@playwright/test` was not installed even though the Playwright CLI was present. The matching `1.60.0` test package was added with `npm install --ignore-scripts`, so no browser download was triggered and the existing Chromium cache remained in use.

Vite emits `apps/web/dist` before the repository-wide lint step. The root lint script explicitly ignores workspace `dist` directories so generated bundles are not treated as source; the browser globals used by the web entry point and Playwright evaluation callbacks are declared on that command.
