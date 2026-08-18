import { ApplicationDraftSaveRequestSchema } from '@panshi/contracts'
import { extractConfirmationOptions, runConfirmedOperation } from '../confirmation-flow.js'
import { CliRuntimeError } from '../errors.js'
import { parseOptions, readJsonInput, requiredString } from './options.js'
import type { CommandHandler } from './types.js'

export const runApplicationShow: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'application show 不接受额外参数')
  return { data: (await client.application.getMine()).data }
}

export const runApplicationValidate: CommandHandler = async ({ args, stdin }) => {
  const { positionals, values } = parseOptions(args, { '--input': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'application validate 参数无效')
  const input = await readJsonInput(requiredString(values, 'input'), stdin)
  const parsed = ApplicationDraftSaveRequestSchema.safeParse(input)
  return { data: parsed.success
    ? { valid: true }
    : { valid: false, issues: parsed.error.issues.map(({ path, code, message }) => ({ path: path.map(String).join('.'), code, message })) } }
}

const applicationBinding = (body: ReturnType<typeof ApplicationDraftSaveRequestSchema.parse>) => ({
  expectedRevision: body.expectedRevision,
  profileFields: Object.keys(body.profile).sort(),
  answerIds: Object.keys(body.answers).sort(),
  attachmentSlotIds: body.attachments.map(({ slotId }) => slotId).sort(),
})

export const runApplicationDraftSave: CommandHandler = async (context) => {
  const extracted = extractConfirmationOptions(context.args)
  const { positionals, values } = parseOptions(extracted.remaining, { '--input': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'application draft save 参数无效')
  const body = ApplicationDraftSaveRequestSchema.parse(await readJsonInput(requiredString(values, 'input'), context.stdin))
  const currentForm = (await context.client.public.getRegistrationForm()).data.form
  const questionIds = new Set(currentForm.questions.map(({ id }) => id))
  const slotIds = new Set(currentForm.attachments.filter(({ active }) => active).map(({ id }) => id))
  if (Object.keys(body.answers).some((id) => !questionIds.has(id)) || body.attachments.some(({ slotId }) => !slotIds.has(slotId))) {
    throw new CliRuntimeError('INPUT_INVALID', '报名内容引用了当前表单中不存在或未启用的字段')
  }
  const preview = applicationBinding(body)
  const response = await runConfirmedOperation({
    capabilityId: 'application.draft.save', previewPayload: preview, executionPayload: body,
    json: context.json, options: extracted.options, prepare: context.client.confirmations.prepare,
    confirm: context.confirm as never, execute: async (confirmation) => await context.client.application.saveDraft(body, confirmation),
  })
  return { data: response.data }
}

const runRevisionMutation = async (context: Parameters<CommandHandler>[0], capabilityId: 'application.reopen' | 'application.submit') => {
  const extracted = extractConfirmationOptions(context.args)
  if (extracted.remaining.length) throw new CliRuntimeError('INPUT_INVALID', `application ${capabilityId.endsWith('submit') ? 'submit' : 'reopen'} 参数无效`)
  const current = await context.client.application.getMine()
  const expectedRevision = current.data.application.revision
  const payload = { expectedRevision }
  const response = await runConfirmedOperation({
    capabilityId, previewPayload: payload, executionPayload: payload, json: context.json,
    options: extracted.options, prepare: context.client.confirmations.prepare, confirm: context.confirm as never,
    execute: async (confirmation) => capabilityId === 'application.submit'
      ? await context.client.application.submit(expectedRevision, confirmation)
      : await context.client.application.reopen(expectedRevision, confirmation),
  })
  return { data: response.data }
}

export const runApplicationReopen: CommandHandler = async (context) => runRevisionMutation(context, 'application.reopen')
export const runApplicationSubmit: CommandHandler = async (context) => runRevisionMutation(context, 'application.submit')
