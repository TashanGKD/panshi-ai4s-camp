import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.TEST_DATABASE_URL
const exact = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
if (process.env.CLI_E2E !== '1' || databaseUrl !== exact) throw new Error('CLI_E2E and exact test database are required')
for (const key of ['E2E_VERIFICATION_CODE', 'E2E_REGISTER_PHONE', 'E2E_REGISTER_PASSWORD', 'E2E_ADMIN_PASSWORD', 'VERIFICATION_SECRET'] as const) {
  if (!process.env[key]) throw new Error(`${key} is required`)
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'cli-learner-workflow.spec.ts',
  outputDir: './test-results/cli',
  workers: 1,
  fullyParallel: false,
  globalTeardown: './e2e/application.teardown.ts',
  webServer: {
    command: 'node scripts/e2e-api-server.mjs --fixture application',
    url: 'http://127.0.0.1:3023/healthz',
    reuseExistingServer: false,
    env: {
      API_PORT: '3023', DATABASE_URL: databaseUrl, APPLICATION_E2E: '1', NODE_ENV: 'test', JSON_BODY_LIMIT: '1mb',
      CORS_ORIGINS: 'http://127.0.0.1:4196', HEALTHCHECK_TIMEOUT_MS: '2000', SESSION_TTL_SECONDS: '28800',
      VERIFICATION_PROVIDER: 'mock', VERIFICATION_SECRET: process.env.VERIFICATION_SECRET!,
      VERIFICATION_MOCK_CODE: process.env.E2E_VERIFICATION_CODE!, VERIFICATION_TTL_SECONDS: '300',
      VERIFICATION_COOLDOWN_SECONDS: '10', VERIFICATION_MAX_ATTEMPTS: '3',
      FILE_STORAGE_ROOT: 'var/e2e-uploads', FILE_UPLOAD_TEMP_ROOT: 'var/e2e-temp',
      E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD!,
    },
  },
})
