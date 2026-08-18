import { CliFailureSchema, CliSuccessSchema } from '@panshi/contracts'

type Write = (text: string) => unknown
export const createOutput = (input: { json: boolean, stdout?: Write, stderr?: Write }) => {
  const stdout = input.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = input.stderr ?? ((text: string) => process.stderr.write(text))
  return {
    progress: (message: string) => stderr(`${message}\n`),
    success: (value: unknown) => {
      const parsed = CliSuccessSchema.parse(value)
      stdout(input.json ? `${JSON.stringify(parsed)}\n` : `${JSON.stringify(parsed.data, null, 2)}\n`)
    },
    failure: (value: unknown) => {
      const parsed = CliFailureSchema.parse(value)
      const rendered = input.json ? JSON.stringify(parsed) : `${parsed.code}: ${parsed.message}`
      stderr(`${rendered}\n`)
    },
    text: (value: string) => stdout(`${value}\n`),
  }
}
