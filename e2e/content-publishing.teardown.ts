import { runContentPublishingFixture } from '../apps/api/src/cli/content-publishing-e2e-fixture'

export default async function teardownContentPublishingFixture() {
  await runContentPublishingFixture('cleanup', {
    databaseUrl: process.env.TEST_DATABASE_URL,
    enabled: process.env.PUBLISHING_E2E,
    phone: process.env.E2E_ADMIN_PHONE,
    password: process.env.E2E_ADMIN_PASSWORD,
  })
}
