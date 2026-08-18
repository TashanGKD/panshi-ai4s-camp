import type { createCampClient } from '@panshi/camp-client'
import type { LearnerCapabilityId } from '@panshi/contracts'
import type { CredentialStore } from '../credentials.js'

export type CampClient = ReturnType<typeof createCampClient>

export type CommandContext = {
  client: CampClient
  args: string[]
  json: boolean
  profileName: string
  phoneHint?: string
  credentials: CredentialStore
  workspaceRoot: string
  homeDirectory: string
  stdin: () => Promise<string>
  promptText: (label: string) => Promise<string>
  readSecret: (label: string) => Promise<string>
  confirm: (preview: unknown) => Promise<boolean>
}

export type CommandResult = { data: unknown, requestId?: string }
export type CommandHandler = (context: CommandContext) => Promise<CommandResult>
export type LearnerCommand = { capabilityId: LearnerCapabilityId, path: readonly string[], run: CommandHandler }

export const command = (capabilityId: LearnerCapabilityId, path: readonly string[], run: CommandHandler): LearnerCommand => ({ capabilityId, path, run })
