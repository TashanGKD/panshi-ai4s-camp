import { defineConfig } from '@playwright/test'

const exactDatabaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
const databaseUrl = process.env.TEST_DATABASE_URL
if (process.env.LAUNCH_E2E !== '1' || databaseUrl !== exactDatabaseUrl) throw new Error(`Launch E2E requires LAUNCH_E2E=1 and TEST_DATABASE_URL=${exactDatabaseUrl}`)
for (const key of ['E2E_VERIFICATION_CODE', 'E2E_ADMIN_PASSWORD', 'VERIFICATION_SECRET'] as const) if (!process.env[key]) throw new Error(`${key} is required`)

export default defineConfig({
  testDir: './e2e', testMatch: ['full-journey.spec.ts', 'access-control.spec.ts'], workers: 1, fullyParallel: false,
  outputDir: './test-results/launch', globalTeardown: './e2e/launch.teardown.ts', timeout: 60_000,
  use: { browserName: 'chromium', colorScheme: 'light', locale: 'zh-CN', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai', trace: 'retain-on-failure' },
  webServer: [{
    command: "npm run db:migrate -w @panshi/api && trap 'npm run e2e:launch-fixture -w @panshi/api -- cleanup >/dev/null 2>&1 || true' EXIT; npm run e2e:launch-fixture -w @panshi/api -- seed && node --import tsx apps/api/src/server.ts",
    url: 'http://127.0.0.1:3030/healthz', reuseExistingServer: false, timeout: 120_000,
    env: {
      API_PORT: '3030', DATABASE_URL: databaseUrl, LAUNCH_E2E: '1', APPLICATION_E2E: '1', NODE_ENV: 'test', JSON_BODY_LIMIT: '1mb',
      CORS_ORIGINS: 'http://127.0.0.1:4200,http://127.0.0.1:4201', HEALTHCHECK_TIMEOUT_MS: '2000', SESSION_TTL_SECONDS: '28800',
      VERIFICATION_PROVIDER: 'mock', VERIFICATION_SECRET: process.env.VERIFICATION_SECRET!, VERIFICATION_MOCK_CODE: process.env.E2E_VERIFICATION_CODE!,
      VERIFICATION_TTL_SECONDS: '300', VERIFICATION_COOLDOWN_SECONDS: '10', VERIFICATION_MAX_ATTEMPTS: '3',
      FILE_STORAGE_ROOT: 'var/e2e-uploads', FILE_UPLOAD_TEMP_ROOT: 'var/e2e-temp', E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD!,
    },
  }, { command: 'npm run dev -w @panshi/web -- --host 127.0.0.1 --port 4200', url: 'http://127.0.0.1:4200', reuseExistingServer: false, env: { VITE_API_BASE_URL: 'http://127.0.0.1:3030' } },
  { command: 'npm run dev -w @panshi/admin -- --host 127.0.0.1 --port 4201', url: 'http://127.0.0.1:4201/admin/', reuseExistingServer: false, env: { VITE_API_BASE_URL: 'http://127.0.0.1:3030', VITE_PUBLIC_WEB_BASE_URL: 'http://127.0.0.1:4200' } }],
})
