# Visual source alignment

The test-only `legacyReference` in `visual.spec.ts` copies the common values from `frontend/src/styles/conferences.css` and `frontend/src/styles/App.css`: the Banner gradient, typography, 1200px container, navigation, 21px heading, and 4px marker. It is not imported by the web runtime. A computed-style contract test verifies that this CSS is parsed and active, including its gradient, title, navigation, heading, and marker values.

The independent Vite harness under `e2e/harness` performs the direct source comparison. It renders a faithful source-CSS reference and the real `@panshi/ui` components at the same viewport origin with identical normalized content. Playwright captures the Banner content box, full navigation, section heading marker, and compact card as PNG buffers. `pngjs` decodes each pair; dimensions must match and the RGBA comparison requires exactly zero different channels. No screenshot mask or pixel threshold is used.

The independent shell intentionally omits the legacy fixed generic header and “返回会议”. Therefore its Banner begins at the page top with the intentional desktop shell padding `44px 0 40px`, and the sticky event navigation uses `top: 0` instead of the legacy `top: 72px`. The harness normalizes only those outer offsets before direct comparison. No color, font size, line height, horizontal or inner spacing, border, radius, shadow, or marker geometry is normalized or masked.

At `max-width: 640px`, the only migrated visual rule is the source title size of `23px`. The navigation inner wrapper uses `width: max-content` solely as structural overflow sizing for the approved single-row horizontal navigation; it is not a design token or visual estimate. Page gutter remains the source `24px`, and Banner padding remains the intentional independent-shell `44px 0 40px` at every viewport.

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
