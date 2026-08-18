import type { LearnerCapabilityId } from '@panshi/contracts'

export const webCapabilities = {
  '/': ['public.site.show', 'public.application_count.show'],
  '/schedule': ['public.schedule.list'],
  '/travel': ['public.content.show', 'public.travel.show'],
  '/contact': ['public.contacts.show'],
  '/resources': ['resource.list', 'resource.download'],
  '/register': ['auth.verification.send', 'auth.register'],
  '/login': ['auth.login'],
  '/forgot-password': ['auth.verification.send', 'auth.password_reset'],
  '/application': [
    'public.registration_form.show', 'public.institutions.search', 'application.show', 'application.validate',
    'application.draft.save', 'application.reopen', 'application.submit', 'file.upload', 'file.download', 'file.delete',
  ],
  '/account': ['auth.status', 'auth.logout', 'account.password_change', 'application.show', 'check_in.show', 'check_in.qr.export'],
} as const satisfies Record<string, readonly LearnerCapabilityId[]>
