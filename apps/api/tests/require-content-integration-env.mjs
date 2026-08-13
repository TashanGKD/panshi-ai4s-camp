const value = process.env.TEST_DATABASE_URL

let validDedicatedDatabase = false
if (value) {
  try {
    const url = new URL(value)
    validDedicatedDatabase = (url.protocol === 'postgres:' || url.protocol === 'postgresql:')
      && url.pathname === '/panshi_ai4s_camp_test'
  } catch {
    validDedicatedDatabase = false
  }
}

if (!value) {
  console.error('TEST_DATABASE_URL is required for content integration tests')
  process.exitCode = 1
} else if (!validDedicatedDatabase) {
  console.error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
  process.exitCode = 1
}
