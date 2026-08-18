#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createCampClient } from '@panshi/camp-client'
import { learnerCapabilities } from '@panshi/contracts'
import { parseCliArgv } from './argv.js'
import { CliRuntimeError, safeError } from './errors.js'
import { createOutput } from './output.js'
import { loadConfig, resolveEndpoint, type CliConfig } from './config.js'
import { KeychainCredentialStore, type CredentialStore } from './credentials.js'
import { readSecret as readSecretInput, readSecretBundle } from './io.js'
import { executeCommand, findCommand } from './commands/registry.js'
import { runSkillCommand } from './commands/skill.js'
import { exportCliCapabilities } from './commands/internal.js'

const HELP = `磐石·科学智能实训营 CLI

用法：panshi-camp [--json] [--profile NAME] <命令>

公开信息：info show；content get；schedule list；travel show；contacts show；institutions search
报名与资料：application form/show/validate；resources list/download；files download
账号与报到：auth login/status；check-in show；check-in qr export
Skill：skill path；skill install --agent codex|claude-code`

type Dependencies = {
  stdout?: (text: string) => unknown
  stderr?: (text: string) => unknown
  fetch?: typeof globalThis.fetch
  readConfig?: (path: string) => Promise<CliConfig>
  getCredential?: () => Promise<unknown>
  credentialStore?: CredentialStore
  configPath?: string
  homeDirectory?: string
  workspaceRoot?: string
  stdin?: () => Promise<string>
  promptText?: (label: string) => Promise<string>
  readSecret?: (label: string) => Promise<string>
  readSecrets?: (fields: Array<{ key: string, label: string }>) => Promise<Record<string, string>>
  confirm?: (preview: unknown, mode?: 'single' | 'double', targetIdentifier?: string) => Promise<boolean>
}

const promptText = async (label: string) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new CliRuntimeError('INTERACTIVE_INPUT_REQUIRED', `${label}需要交互式终端`)
  const terminal = createInterface({ input: process.stdin, output: process.stderr })
  try { return (await terminal.question(`${label}: `)).trim() } finally { terminal.close() }
}

const confirmPreview = async (preview: unknown, mode: 'single' | 'double' = 'single', targetIdentifier?: string) => {
  process.stderr.write(`确认预览：\n${JSON.stringify(preview, null, 2)}\n`)
  if ((await promptText('确认执行？请输入 y')).toLocaleLowerCase() !== 'y') return false
  if (mode === 'double') return (await promptText(`请再次输入目标标识 ${targetIdentifier ?? ''}`)) === targetIdentifier
  return true
}

const defaultConfigPath = (home: string) => join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'panshi-camp', 'config.json')

export const runCli = async (argv: string[], dependencies: Dependencies = {}): Promise<number> => {
  let json = argv.includes('--json')
  try {
    const parsed = parseCliArgv(argv)
    json = parsed.json
    const output = createOutput({ json, stdout: dependencies.stdout, stderr: dependencies.stderr })
    if (parsed.help || parsed.command.length === 0 || parsed.command[0] === 'help') {
      if (json) {
        output.success({ ok: true, apiVersion: 'v1', capabilityId: 'public.site.show', data: { help: HELP }, requestId: 'local' })
      } else output.text(HELP)
      return 0
    }
    const homeDirectory = dependencies.homeDirectory ?? homedir()
    if (parsed.command[0] === 'internal' && parsed.command[1] === 'capabilities' && parsed.command.length === 2) {
      if (!json) throw new CliRuntimeError('INPUT_INVALID', 'internal capabilities 仅支持 --json')
      ;(dependencies.stdout ?? ((text: string) => process.stdout.write(text)))(`${JSON.stringify(exportCliCapabilities())}\n`)
      return 0
    }
    if (parsed.command[0] === 'skill') {
      if (json) throw new CliRuntimeError('INPUT_INVALID', 'skill 管理命令仅支持人工可读模式')
      const result = await runSkillCommand(parsed.command.slice(1), {
        homeDirectory,
        onPreview: (preview) => output.text(`Skill 安装预览：\n${JSON.stringify(preview, null, 2)}`),
      })
      output.text(JSON.stringify(result, null, 2))
      return 0
    }
    const credentials = dependencies.credentialStore ?? new KeychainCredentialStore()
    let profile: { name: string, baseUrl: string, phoneHint?: string } | undefined
    if (parsed.profile) {
      const config = await (dependencies.readConfig ?? loadConfig)(dependencies.configPath ?? defaultConfigPath(homeDirectory))
      const configured = config.profiles[parsed.profile]
      if (!configured) throw new CliRuntimeError('RESOURCE_NOT_FOUND', `未找到配置：${parsed.profile}`)
      profile = { name: parsed.profile, ...configured }
    }
    const profileName = profile?.name ?? 'local'
    const baseUrl = resolveEndpoint({ explicitBaseUrl: parsed.baseUrl, profile, environment: parsed.environment })
    const selected = findCommand(parsed.command).command
    const capability = learnerCapabilities.find(({ id }) => id === selected.capabilityId)
    const useCredential = parsed.profile !== undefined || capability?.roles.includes('user') === true
    const client = createCampClient({
      baseUrl,
      fetch: dependencies.fetch,
      ...(useCredential ? {
        credentialProvider: { getToken: async () => {
          if (dependencies.getCredential) return await dependencies.getCredential() as string | null
          return credentials.get(profileName)
        } },
      } : {}),
    })
    const result = await executeCommand(parsed.command, {
      client, json, profileName, credentials,
      ...(profile?.phoneHint ? { phoneHint: profile.phoneHint } : {}),
      homeDirectory,
      workspaceRoot: dependencies.workspaceRoot ?? process.cwd(),
      stdin: dependencies.stdin ?? (async () => readFileSync(0, 'utf8')),
      promptText: dependencies.promptText ?? promptText,
      readSecret: dependencies.readSecret ?? ((label) => readSecretInput({ isTTY: Boolean(process.stdin.isTTY), env: process.env }, label)),
      readSecrets: dependencies.readSecrets ?? ((fields) => readSecretBundle({ isTTY: Boolean(process.stdin.isTTY), env: process.env }, fields)),
      confirm: dependencies.confirm ?? confirmPreview,
    })
    output.success({ ok: true, apiVersion: 'v1', capabilityId: result.capabilityId, data: result.data, requestId: result.requestId ?? 'local' })
    return 0
  } catch (error) {
    const output = createOutput({ json, stdout: dependencies.stdout, stderr: dependencies.stderr })
    const safe = safeError(error)
    output.failure({ ok: false, code: safe.code, message: safe.message, details: safe.details, requestId: safe.requestId })
    return 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = await runCli(process.argv.slice(2))
