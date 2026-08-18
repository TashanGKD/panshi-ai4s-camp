import type { LearnerCapabilityId } from '@panshi/contracts'
import { CliRuntimeError } from '../errors.js'
import { runApplicationForm, runContactsShow, runContentGet, runInfoShow, runInstitutionsSearch, runScheduleList, runTravelShow } from './public.js'
import { runApplicationShow, runApplicationValidate } from './application.js'
import { runAuthLogin, runAuthStatus } from './auth.js'
import { runCheckInQrExport, runCheckInShow } from './check-in.js'
import { runFileDownload, runResourceDownload, runResourcesList } from './resources.js'
import { command, type CommandContext, type LearnerCommand } from './types.js'

export const learnerCommands: LearnerCommand[] = [
  command('public.site.show', ['info', 'show'], runInfoShow),
  command('public.content.show', ['content', 'get'], runContentGet),
  command('public.schedule.list', ['schedule', 'list'], runScheduleList),
  command('public.travel.show', ['travel', 'show'], runTravelShow),
  command('public.contacts.show', ['contacts', 'show'], runContactsShow),
  command('public.institutions.search', ['institutions', 'search'], runInstitutionsSearch),
  command('public.registration_form.show', ['application', 'form'], runApplicationForm),
  command('resource.list', ['resources', 'list'], runResourcesList),
  command('resource.download', ['resources', 'download'], runResourceDownload),
  command('auth.login', ['auth', 'login'], runAuthLogin),
  command('auth.status', ['auth', 'status'], runAuthStatus),
  command('application.show', ['application', 'show'], runApplicationShow),
  command('application.validate', ['application', 'validate'], runApplicationValidate),
  command('file.download', ['files', 'download'], runFileDownload),
  command('check_in.show', ['check-in', 'show'], runCheckInShow),
  command('check_in.qr.export', ['check-in', 'qr', 'export'], runCheckInQrExport),
]

export const findCommand = (args: string[]) => {
  const matches = learnerCommands.filter(({ path }) => path.every((part, index) => args[index] === part))
  const selected = matches.sort((a, b) => b.path.length - a.path.length)[0]
  if (!selected) throw new CliRuntimeError('INPUT_INVALID', `未知命令：${args.join(' ')}`)
  return { command: selected, args: args.slice(selected.path.length) }
}

export const executeCommand = async (args: string[], context: Omit<CommandContext, 'args'>) => {
  const matched = findCommand(args)
  const result = await matched.command.run({ ...context, args: matched.args })
  return { capabilityId: matched.command.capabilityId as LearnerCapabilityId, ...result }
}
