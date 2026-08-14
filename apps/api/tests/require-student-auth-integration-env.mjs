const databaseUrl = process.env.TEST_DATABASE_URL
let parsed
try {
  parsed = databaseUrl ? new URL(databaseUrl) : undefined
} catch {
  parsed = undefined
}

if (!parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}
