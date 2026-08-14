const value = process.env.TEST_DATABASE_URL
let valid = false
if (value) {
  try {
    const url = new URL(value)
    valid = (url.protocol === 'postgres:' || url.protocol === 'postgresql:')
      && url.pathname === '/panshi_ai4s_camp_test'
  } catch {
    valid = false
  }
}

if (!value) {
  console.error('TEST_DATABASE_URL is required for schema migration integration tests')
  process.exitCode = 1
} else if (!valid) {
  console.error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
  process.exitCode = 1
}
