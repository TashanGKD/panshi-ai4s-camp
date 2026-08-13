# Visual source alignment

The test-only `legacyReference` in `visual.spec.ts` copies the common values from `frontend/src/styles/conferences.css` and `frontend/src/styles/App.css`: the Banner gradient, typography, 1200px container, navigation, 21px heading, and 4px marker. It is not imported by the web runtime. A computed-style contract test verifies that this CSS is parsed and active, including its gradient, title, navigation, heading, and marker values.

The independent Vite harness under `e2e/harness` performs the direct source comparison. It imports the real `apps/web/src/styles/public.css` and `@panshi/ui/tokens.css`, then renders actual `@panshi/ui` components without test CSS overrides. The source reference is rendered separately at the same viewport origin with identical normalized content. Playwright captures the full Banner, full navigation, section heading marker, and compact card as PNG buffers. `pngjs` decodes each pair; dimensions must match and the RGBA comparison requires exactly zero different channels. No screenshot mask or pixel threshold is used.

All legacy visual declarations and custom properties in `source-reference.css` are scoped below `.source-reference`. The only unscoped harness selectors are `.comparison-grid` and `.comparison-column`, and each may set only `width` for placement. A runtime isolation test records migrated computed styles, disables the source stylesheet, and requires the values to remain identical. A selector audit also rejects unscoped source selectors, migrated selectors, or extra wrapper properties.

The independent shell intentionally omits the legacy fixed generic header and “返回会议”. The source side alone normalizes legacy Banner top padding from `116px` to `44px` while retaining the source bottom padding of `40px`, and normalizes legacy navigation `top: 72px` to `top: 0`. Migrated components are not normalized or overridden. No color, font size, line height, horizontal or inner spacing, border, radius, shadow, or marker geometry is normalized or masked.

At `max-width: 640px`, the only migrated visual rule is the source title size of `23px`. The navigation inner wrapper uses `width: max-content` solely as structural overflow sizing for the approved single-row horizontal navigation; it is not a design token or visual estimate. Page gutter remains the source `24px`, and Banner padding remains the intentional independent-shell `44px 0 40px` at every viewport.

The direct comparison asserts that Banner, Banner container, and navigation widths equal the real viewport width below 1200px. The `390x844` project therefore exercises actual `<=640px` component widths rather than a fixed desktop canvas.

Normal comparison:

```bash
npx playwright test e2e/visual.spec.ts
```

Explicit baseline update only:

```bash
npm run visual:update
```

Committed full-page and legacy-reference snapshots use `{projectName}-{platform}` filenames, so each operating system keeps its own baseline. `visual:test` compares only and fails when the current platform baseline is absent; `visual:update` is the explicit command for generating that platform's files. Developers and CI should use the pinned Playwright/Chromium version and fixed locale, timezone, color scheme, fonts, and viewports, then inspect newly generated images before committing them. The direct source-vs-migrated PNG comparison is environment-local because both buffers are captured in the same browser run; it remains a zero-RGBA comparison and is not replaced or weakened by platform snapshots.

Pixel comparison uses `maxDiffPixels: 0`; there is no nonzero tolerance.

The first baseline run found that `@playwright/test` was not installed even though the Playwright CLI was present. The matching `1.60.0` test package was added with `npm install --ignore-scripts`, so no browser download was triggered and the existing Chromium cache remained in use.

Vite emits `apps/web/dist` before the repository-wide lint step. The root lint script explicitly ignores workspace `dist` directories so generated bundles are not treated as source; the browser globals used by the web entry point and Playwright evaluation callbacks are declared on that command.
