import { runApplicationFixture } from '../apps/api/src/cli/application-e2e-fixture'

export default async function teardownApplicationFixture() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  await runApplicationFixture('cleanup')
}
