import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.TEST_DATABASE_URL
const adminPhone = process.env.E2E_ADMIN_PHONE
const adminPassword = process.env.E2E_ADMIN_PASSWORD
const exactDatabaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'

if (process.env.PUBLISHING_E2E !== '1') throw new Error('PUBLISHING_E2E must equal 1')
if (databaseUrl !== exactDatabaseUrl) throw new Error(`TEST_DATABASE_URL must equal exactly ${exactDatabaseUrl}`)
if (!adminPhone || !adminPassword) throw new Error('E2E_ADMIN_PHONE and E2E_ADMIN_PASSWORD are required')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'content-publishing.spec.ts',
  outputDir: './test-results/content',
  workers: 1,
  fullyParallel: false,
  globalTeardown: './e2e/content-publishing.teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      command: 'node scripts/e2e-api-server.mjs --fixture content',
      url: 'http://127.0.0.1:3001/healthz',
      reuseExistingServer: false,
      env: {
        API_PORT: '3001', DATABASE_URL: databaseUrl, PUBLISHING_E2E: '1', NODE_ENV: 'test', JSON_BODY_LIMIT: '1mb',
        E2E_ADMIN_PHONE: adminPhone, E2E_ADMIN_PASSWORD: adminPassword,
        HEALTHCHECK_TIMEOUT_MS: '2000', SESSION_TTL_SECONDS: '28800',
        CORS_ORIGINS: 'http://127.0.0.1:4173,http://127.0.0.1:4175',
        FILE_STORAGE_ROOT: 'var/content-e2e-uploads', FILE_UPLOAD_TEMP_ROOT: 'var/content-e2e-temp',
      },
    },
    {
      command: 'npm run dev -w @panshi/web -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:3001' },
    },
    {
      command: 'npm run dev -w @panshi/admin -- --host 127.0.0.1 --port 4175',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: false,
      env: {
        VITE_API_BASE_URL: 'http://127.0.0.1:3001',
        VITE_PUBLIC_WEB_BASE_URL: 'http://127.0.0.1:4173',
      },
    },
  ],
})
