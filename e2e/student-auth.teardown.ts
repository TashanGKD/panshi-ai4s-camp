import { runStudentAuthFixture } from '../apps/api/src/cli/student-auth-e2e-fixture'

export default async function teardown() {
  await runStudentAuthFixture('cleanup', {
    databaseUrl: process.env.TEST_DATABASE_URL,
    enabled: process.env.STUDENT_AUTH_E2E,
    resetPhone: process.env.E2E_RESET_PHONE,
    resetPassword: process.env.E2E_RESET_PASSWORD,
  })
}
