import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.TEST_DATABASE_URL
const exactDatabaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
const required = [
  'E2E_VERIFICATION_CODE', 'E2E_REGISTER_PHONE', 'E2E_REGISTER_PASSWORD',
  'E2E_RESET_PHONE', 'E2E_RESET_PASSWORD', 'E2E_RESET_NEW_PASSWORD', 'VERIFICATION_SECRET',
] as const

if (process.env.STUDENT_AUTH_E2E !== '1') throw new Error('STUDENT_AUTH_E2E must equal 1')
if (databaseUrl !== exactDatabaseUrl) throw new Error(`TEST_DATABASE_URL must equal exactly ${exactDatabaseUrl}`)
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`)

export default defineConfig({
  testDir: './e2e', testMatch: 'student-auth.spec.ts', outputDir: './test-results/student-auth', workers: 1, fullyParallel: false,
  globalTeardown: './e2e/student-auth.teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:4183', browserName: 'chromium', locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai', viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      command: "trap 'npm run e2e:student-auth-fixture -w @panshi/api -- cleanup >/dev/null 2>&1 || true' EXIT; npm run db:migrate -w @panshi/api && npm run e2e:student-auth-fixture -w @panshi/api -- seed && node --import tsx apps/api/src/server.ts",
      url: 'http://127.0.0.1:3011/healthz', reuseExistingServer: false,
      env: {
        API_PORT: '3011', DATABASE_URL: databaseUrl, STUDENT_AUTH_E2E: '1', NODE_ENV: 'test', JSON_BODY_LIMIT: '1mb',
        CORS_ORIGINS: 'http://127.0.0.1:4183', HEALTHCHECK_TIMEOUT_MS: '2000', SESSION_TTL_SECONDS: '28800',
        VERIFICATION_PROVIDER: 'mock', VERIFICATION_SECRET: process.env.VERIFICATION_SECRET!,
        VERIFICATION_TTL_SECONDS: '300', VERIFICATION_COOLDOWN_SECONDS: '60', VERIFICATION_MAX_ATTEMPTS: '3',
        VERIFICATION_MOCK_CODE: process.env.E2E_VERIFICATION_CODE!,
        E2E_RESET_PHONE: process.env.E2E_RESET_PHONE!, E2E_RESET_PASSWORD: process.env.E2E_RESET_PASSWORD!,
        FILE_STORAGE_ROOT: 'var/student-auth-e2e-uploads', FILE_UPLOAD_TEMP_ROOT: 'var/student-auth-e2e-temp',
      },
    },
    {
      command: 'npm run dev -w @panshi/web -- --host 127.0.0.1 --port 4183',
      url: 'http://127.0.0.1:4183', reuseExistingServer: false,
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:3011' },
    },
  ],
})
