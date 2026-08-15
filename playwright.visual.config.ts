import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.TEST_DATABASE_URL
const exactDatabaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
if (process.env.VISUAL_E2E !== '1' || databaseUrl !== exactDatabaseUrl) throw new Error(`Visual tests require VISUAL_E2E=1 and TEST_DATABASE_URL=${exactDatabaseUrl}`)

export default defineConfig({
  testDir: './e2e', outputDir: './test-results/visual', snapshotPathTemplate: '{testDir}/baselines/{arg}-{projectName}-{platform}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixels: 0 } }, globalTeardown: './e2e/visual.teardown.ts',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', colorScheme: 'light', locale: 'zh-CN', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' },
  projects: [
    { name: 'desktop-1440x900', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1280x800', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-390x844', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: [{
    command: 'node scripts/e2e-api-server.mjs --fixture visual',
    url: 'http://127.0.0.1:3002/healthz', reuseExistingServer: false,
    env: { API_PORT: '3002', DATABASE_URL: databaseUrl, VISUAL_E2E: '1', NODE_ENV: 'test', JSON_BODY_LIMIT: '1mb', HEALTHCHECK_TIMEOUT_MS: '2000', SESSION_TTL_SECONDS: '28800', CORS_ORIGINS: 'http://127.0.0.1:4173', FILE_STORAGE_ROOT: 'var/visual-e2e-uploads', FILE_UPLOAD_TEMP_ROOT: 'var/visual-e2e-temp' },
  }, { command: 'npm run dev -w @panshi/web -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: false, env: { VITE_API_BASE_URL: 'http://127.0.0.1:3002' } },
  { command: 'vite --config e2e/harness/vite.config.ts --host 127.0.0.1 --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: false }],
})
