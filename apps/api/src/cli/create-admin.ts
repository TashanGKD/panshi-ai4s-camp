import { Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeMainlandChinaMobile } from '@panshi/contracts'
import { createConfiguredDatabaseClient } from '../db/client.js'
import { createIdentityRepository, type AdminCreationRepository } from '../modules/identity/identity.repository.js'
import { hashPassword } from '../modules/identity/password.js'

type CreateAdminArguments = { phone: string, name: string }

export const parseCreateAdminArgs = (args: readonly string[]): CreateAdminArguments => {
  if (args.some((argument) => argument === '--password' || argument.startsWith('--password='))) {
    throw new Error('Password must not be supplied as a command-line argument')
  }

  let phone: string | undefined
  let name: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const value = args[index + 1]
    if (argument === '--phone' && value && !value.startsWith('--')) {
      phone = value
      index += 1
    } else if (argument === '--name' && value && !value.startsWith('--')) {
      name = value
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? ''}`)
    }
  }

  if (!phone || !name?.trim()) throw new Error('--phone and --name are required')
  return { phone, name: name.trim() }
}

export const readHiddenPassword = async (): Promise<string> => {
  process.stderr.write('密码：')
  const hiddenOutput = new Writable({ write: (_chunk, _encoding, callback) => callback() })
  const readline = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true })
  try {
    const password = await readline.question('')
    process.stderr.write('\n')
    return password
  } finally {
    readline.close()
  }
}

export const createAdmin = async (
  args: readonly string[],
  dependencies: { repository: AdminCreationRepository, readPassword: () => Promise<string> },
) => {
  const input = parseCreateAdminArgs(args)
  const password = await dependencies.readPassword()
  await dependencies.repository.createAdmin({
    displayName: input.name,
    phoneNormalized: normalizeMainlandChinaMobile(input.phone),
    passwordHash: await hashPassword(password),
    role: 'admin',
  })
}

export const runCreateAdminCli = async (args = process.argv.slice(2)) => {
  try {
    parseCreateAdminArgs(args)
  } catch {
    console.error('管理员账号创建失败：参数、手机号或重复账号无效')
    process.exitCode = 1
    return
  }
  const database = createConfiguredDatabaseClient()
  try {
    await createAdmin(args, {
      repository: createIdentityRepository(database.db),
      readPassword: readHiddenPassword,
    })
    console.log('管理员账号已创建')
  } catch {
    console.error('管理员账号创建失败：参数、手机号或重复账号无效')
    process.exitCode = 1
  } finally {
    await database.close()
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) await runCreateAdminCli()
