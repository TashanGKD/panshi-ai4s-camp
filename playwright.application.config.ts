import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.TEST_DATABASE_URL
const exact = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
if (process.env.APPLICATION_E2E !== '1' || databaseUrl !== exact) throw new Error('APPLICATION_E2E and exact test database are required')
for (const key of ['E2E_VERIFICATION_CODE', 'E2E_REGISTER_PHONE', 'E2E_REGISTER_PASSWORD', 'VERIFICATION_SECRET'] as const) if (!process.env[key]) throw new Error(`${key} is required`)

export default defineConfig({
  testDir: './e2e', testMatch: 'application-submit.spec.ts', outputDir: './test-results/application', workers: 1, fullyParallel: false,
  globalTeardown: './e2e/application.teardown.ts',
  use: { baseURL: 'http://127.0.0.1:4193', browserName: 'chromium', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 800 } },
  webServer: [{
    command: 'node scripts/e2e-api-server.mjs --fixture application',
    url: 'http://127.0.0.1:3021/healthz', reuseExistingServer: false,
    env: { API_PORT: '3021', DATABASE_URL: databaseUrl, APPLICATION_E2E: '1', NODE_ENV: 'test', JSON_BODY_LIMIT: '1mb', CORS_ORIGINS: 'http://127.0.0.1:4193', HEALTHCHECK_TIMEOUT_MS: '2000', SESSION_TTL_SECONDS: '28800', VERIFICATION_PROVIDER: 'mock', VERIFICATION_SECRET: process.env.VERIFICATION_SECRET!, VERIFICATION_MOCK_CODE: process.env.E2E_VERIFICATION_CODE!, VERIFICATION_TTL_SECONDS: '300', VERIFICATION_COOLDOWN_SECONDS: '10', VERIFICATION_MAX_ATTEMPTS: '3', FILE_STORAGE_ROOT: 'var/e2e-uploads', FILE_UPLOAD_TEMP_ROOT: 'var/e2e-temp' },
  }, {
    command: 'npm run dev -w @panshi/web -- --host 127.0.0.1 --port 4193', url: 'http://127.0.0.1:4193', reuseExistingServer: false, env: { VITE_API_BASE_URL: 'http://127.0.0.1:3021' },
  }],
})
