const required = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
if (process.env.TEST_DATABASE_URL !== required) {
  console.error(`TEST_DATABASE_URL must equal exactly ${required}`)
  process.exitCode = 1
}
