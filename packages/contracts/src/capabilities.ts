import { z } from 'zod'

export const learnerCapabilityIds = [
  'public.site.show',
  'public.content.show',
  'public.schedule.list',
  'public.travel.show',
  'public.contacts.show',
  'public.institutions.search',
  'public.registration_form.show',
  'public.application_count.show',
  'resource.list',
  'resource.download',
  'auth.verification.send',
  'auth.register',
  'auth.login',
  'auth.status',
  'auth.logout',
  'auth.password_reset',
  'account.password_change',
  'application.show',
  'application.validate',
  'application.draft.save',
  'application.reopen',
  'application.submit',
  'file.upload',
  'file.download',
  'file.hide',
  'file.delete',
  'check_in.show',
  'check_in.qr.export',
] as const

export const LearnerCapabilityIdSchema = z.enum(learnerCapabilityIds)
export const CapabilityRoleSchema = z.enum(['anonymous', 'user', 'admin'])
export const CapabilityEffectSchema = z.enum(['read', 'write', 'delete'])
export const CapabilityConfirmationSchema = z.enum(['none', 'single', 'double'])

const anonymousMutations = new Set([
  'auth.verification.send',
  'auth.register',
  'auth.login',
  'auth.password_reset',
])

export const CapabilitySchema = z.strictObject({
  id: LearnerCapabilityIdSchema,
  apiOperation: z.string().min(1),
  webSurface: z.array(z.string().min(1)).min(1),
  cliCommand: z.string().min(1),
  skillIndex: z.array(z.string().min(1)).min(1),
  roles: z.array(CapabilityRoleSchema).min(1),
  effect: CapabilityEffectSchema,
  confirmation: CapabilityConfirmationSchema,
  outputSchema: z.string().min(1),
  phase: z.enum(['learner-v1', 'admin-v2']),
}).superRefine((capability, context) => {
  if (new Set(capability.roles).size !== capability.roles.length) {
    context.addIssue({ code: 'custom', path: ['roles'], message: 'Capability roles must be unique' })
  }

  if (capability.effect === 'read' && capability.confirmation !== 'none') {
    context.addIssue({ code: 'custom', path: ['confirmation'], message: 'Read capabilities cannot require confirmation' })
  }

  if (capability.effect === 'write' && capability.confirmation === 'none') {
    context.addIssue({ code: 'custom', path: ['confirmation'], message: 'Write capabilities require confirmation' })
  }

  if (capability.effect === 'delete' && capability.confirmation !== 'double') {
    context.addIssue({ code: 'custom', path: ['confirmation'], message: 'Delete capabilities require double confirmation' })
  }

  if (
    capability.roles.includes('anonymous')
    && capability.effect !== 'read'
    && !anonymousMutations.has(capability.id)
  ) {
    context.addIssue({ code: 'custom', path: ['roles'], message: 'Anonymous users cannot perform this mutation' })
  }
})

export const CapabilityRegistrySchema = z.array(CapabilitySchema).superRefine((capabilities, context) => {
  const ids = new Set<string>()
  capabilities.forEach((capability, index) => {
    if (ids.has(capability.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: `Duplicate capability id: ${capability.id}` })
    }
    ids.add(capability.id)
  })
})

const defineCapability = (
  id: z.infer<typeof LearnerCapabilityIdSchema>,
  apiOperation: string,
  webSurface: string[],
  cliCommand: string,
  skillIndex: string[],
  roles: Array<z.infer<typeof CapabilityRoleSchema>>,
  effect: z.infer<typeof CapabilityEffectSchema>,
  confirmation: z.infer<typeof CapabilityConfirmationSchema>,
  outputSchema: string,
) => ({ id, apiOperation, webSurface, cliCommand, skillIndex, roles, effect, confirmation, outputSchema, phase: 'learner-v1' as const })

export const learnerCapabilities = CapabilityRegistrySchema.parse([
  defineCapability('public.site.show', 'GET /api/v1/public/site', ['/'], 'info show', ['info.show'], ['anonymous'], 'read', 'none', 'PublicSiteResponse'),
  defineCapability('public.content.show', 'GET /api/v1/public/content/:key', ['/'], 'content get <key>', ['content.show'], ['anonymous'], 'read', 'none', 'PublicContentResponse'),
  defineCapability('public.schedule.list', 'GET /api/v1/public/schedule', ['/schedule'], 'schedule list', ['schedule.list'], ['anonymous'], 'read', 'none', 'PublicScheduleResponse'),
  defineCapability('public.travel.show', 'GET /api/v1/public/content/travel', ['/travel'], 'travel show', ['travel.show'], ['anonymous'], 'read', 'none', 'PublicContentResponse'),
  defineCapability('public.contacts.show', 'GET /api/v1/public/content/contacts', ['/contact'], 'contacts show', ['contacts.show'], ['anonymous'], 'read', 'none', 'PublicContentResponse'),
  defineCapability('public.institutions.search', 'GET /api/v1/public/institutions', ['/application'], 'institutions search <query>', ['institutions.search'], ['anonymous'], 'read', 'none', 'InstitutionSearchResponse'),
  defineCapability('public.registration_form.show', 'GET /api/v1/public/registration-form', ['/application'], 'application form', ['registration_form.show'], ['anonymous'], 'read', 'none', 'RegistrationFormResponse'),
  defineCapability('public.application_count.show', 'GET /api/v1/public/statistics/applications', ['/'], 'application-count show', ['application_count.show'], ['anonymous'], 'read', 'none', 'ApplicationCountResponse'),
  defineCapability('resource.list', 'GET /api/v1/resources', ['/resources'], 'resources list', ['resources.list'], ['anonymous', 'user'], 'read', 'none', 'ResourceListResponse'),
  defineCapability('resource.download', 'GET /api/v1/resources/:id/download', ['/resources'], 'resources download <id>', ['resources.download'], ['anonymous', 'user'], 'read', 'none', 'ResourceDownloadResponse'),
  defineCapability('auth.verification.send', 'POST /api/v1/auth/verification/send', ['/register', '/forgot-password'], 'auth verification send', ['auth.verification.send'], ['anonymous', 'user'], 'write', 'single', 'VerificationSendResponse'),
  defineCapability('auth.register', 'POST /api/v1/auth/register', ['/register'], 'auth register', ['auth.register'], ['anonymous'], 'write', 'single', 'AuthResponse'),
  defineCapability('auth.login', 'POST /api/v1/auth/login', ['/login'], 'auth login', ['auth.login'], ['anonymous', 'user'], 'write', 'single', 'AuthResponse'),
  defineCapability('auth.status', 'GET /api/v1/me/profile', ['/account'], 'auth status', ['auth.status'], ['user'], 'read', 'none', 'ProfileResponse'),
  defineCapability('auth.logout', 'POST /api/v1/auth/logout', ['/account'], 'auth logout', ['auth.logout'], ['user'], 'write', 'single', 'EmptyResponse'),
  defineCapability('auth.password_reset', 'POST /api/v1/auth/password/reset', ['/forgot-password'], 'auth password reset', ['auth.password_reset'], ['anonymous', 'user'], 'write', 'single', 'PasswordResetResponse'),
  defineCapability('account.password_change', 'POST /api/v1/me/account/password', ['/account'], 'account password change', ['account.password_change'], ['user'], 'write', 'single', 'PasswordChangeResponse'),
  defineCapability('application.show', 'GET /api/v1/me/application', ['/application', '/account'], 'application show', ['application.show'], ['user'], 'read', 'none', 'ApplicationResponse'),
  defineCapability('application.validate', 'LOCAL application validation', ['/application'], 'application validate', ['application.validate'], ['user'], 'read', 'none', 'ApplicationValidationResponse'),
  defineCapability('application.draft.save', 'PUT /api/v1/me/application/draft', ['/application'], 'application draft save', ['application.draft.save'], ['user'], 'write', 'single', 'ApplicationResponse'),
  defineCapability('application.reopen', 'POST /api/v1/me/application/reopen', ['/application', '/account'], 'application reopen', ['application.reopen'], ['user'], 'write', 'single', 'ApplicationResponse'),
  defineCapability('application.submit', 'POST /api/v1/me/application/submit', ['/application'], 'application submit', ['application.submit'], ['user'], 'write', 'single', 'ApplicationResponse'),
  defineCapability('file.upload', 'POST /api/v1/files', ['/application'], 'files upload <path>', ['files.upload'], ['user'], 'write', 'single', 'FileResponse'),
  defineCapability('file.download', 'GET /api/v1/files/:id/download', ['/application'], 'files download <id>', ['files.download'], ['user'], 'read', 'none', 'FileDownloadResponse'),
  defineCapability('file.hide', 'PATCH /api/v1/files/:id/hide', ['/application'], 'files hide <id>', ['files.hide'], ['user'], 'write', 'single', 'FileResponse'),
  defineCapability('file.delete', 'DELETE /api/v1/files/:id', ['/application'], 'files delete <id>', ['files.delete'], ['user'], 'delete', 'double', 'EmptyResponse'),
  defineCapability('check_in.show', 'GET /api/v1/me/check-in', ['/account'], 'check-in show', ['check_in.show'], ['user'], 'read', 'none', 'CheckInResponse'),
  defineCapability('check_in.qr.export', 'LOCAL check-in QR export', ['/account'], 'check-in qr export', ['check_in.qr.export'], ['user'], 'read', 'none', 'CheckInQrExportResponse'),
])

export type LearnerCapabilityId = z.infer<typeof LearnerCapabilityIdSchema>
export type Capability = z.infer<typeof CapabilitySchema>
