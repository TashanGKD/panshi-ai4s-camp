import { runLaunchFixture } from '../apps/api/src/cli/launch-e2e-fixture'

export default async function teardownLaunchFixture() {
  process.env.LAUNCH_E2E = '1'
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  await runLaunchFixture('cleanup')
}
