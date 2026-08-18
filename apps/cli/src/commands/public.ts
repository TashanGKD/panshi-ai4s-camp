import { ContentModuleKeySchema } from '@panshi/contracts'
import { CliRuntimeError } from '../errors.js'
import { parseOptions } from './options.js'
import type { CommandHandler } from './types.js'

export const runInfoShow: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'info show 不接受额外参数')
  return { data: (await client.public.getSite()).data }
}

export const runContentGet: CommandHandler = async ({ client, args }) => {
  const parsed = ContentModuleKeySchema.safeParse(args[0])
  if (!parsed.success || args.length !== 1) throw new CliRuntimeError('INPUT_INVALID', '请提供有效的内容模块 key')
  return { data: (await client.public.getContent(parsed.data)).data }
}

export const runScheduleList: CommandHandler = async ({ client, args }) => {
  const { positionals, values } = parseOptions(args, { '--date': 'string', '--topic': 'string' })
  if (positionals.length) throw new CliRuntimeError('INPUT_INVALID', 'schedule list 参数无效')
  const response = await client.public.getSchedule()
  const date = typeof values.date === 'string' ? values.date : undefined
  const topic = typeof values.topic === 'string' ? values.topic.trim().toLocaleLowerCase('zh-CN') : undefined
  const days = response.data.schedule.days
    .filter((day) => !date || day.date === date)
    .map((day) => ({ ...day, sessions: topic ? day.sessions.filter((session) => JSON.stringify(session).toLocaleLowerCase('zh-CN').includes(topic)) : day.sessions }))
    .filter((day) => !topic || day.sessions.length > 0)
  return { data: { ...response.data, schedule: { ...response.data.schedule, days } } }
}

export const runTravelShow: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'travel show 不接受额外参数')
  return { data: await client.public.getTravel() }
}

export const runContactsShow: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'contacts show 不接受额外参数')
  return { data: await client.public.getContacts() }
}

export const runInstitutionsSearch: CommandHandler = async ({ client, args }) => {
  const query = args.join(' ').trim().toLocaleLowerCase('zh-CN')
  if (!query) throw new CliRuntimeError('INPUT_INVALID', '请提供检索词')
  const response = await client.public.getInstitutions()
  return { data: {
    version: response.data.version,
    universities: response.data.universities.filter(({ name, province, level }) => `${name} ${province} ${level}`.toLocaleLowerCase('zh-CN').includes(query)),
    ucasTrainingUnits: response.data.ucasTrainingUnits.filter(({ name, type }) => `${name} ${type}`.toLocaleLowerCase('zh-CN').includes(query)),
  } }
}

export const runApplicationForm: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'application form 不接受额外参数')
  return { data: (await client.public.getRegistrationForm()).data }
}

export const runApplicationCountShow: CommandHandler = async ({ client, args }) => {
  if (args.length) throw new CliRuntimeError('INPUT_INVALID', 'application-count show 不接受额外参数')
  return { data: (await client.public.getApplicationCount()).data }
}
