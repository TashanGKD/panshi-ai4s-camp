import { runVisualFixture } from '../apps/api/src/cli/visual-e2e-fixture'

export default async function teardownVisualFixture() {
  await runVisualFixture('cleanup', {
    databaseUrl: process.env.TEST_DATABASE_URL,
    enabled: process.env.VISUAL_E2E,
  })
}
