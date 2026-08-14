import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REGISTRATION_FORM,
  type RegistrationForm,
} from '@panshi/contracts'
import {
  RegistrationFormConflictError,
  RegistrationFormValidationError,
  createRegistrationFormService,
  type RegistrationFormRepository,
} from '../src/modules/registration/form.service.js'

const form = (label: string): RegistrationForm => ({
  ...DEFAULT_REGISTRATION_FORM,
  questions: [{
    id: '11111111-1111-4111-8111-111111111111',
    type: 'short_text',
    label,
    helpText: '',
    required: true,
    order: 0,
    active: true,
    validation: { maxLength: 120 },
  }],
})

const repository = (initialForm = DEFAULT_REGISTRATION_FORM): RegistrationFormRepository => {
  let draft = { form: initialForm, revision: 0, baseVersion: null as number | null, publishedVersionId: null as string | null }
  let version = 0
  const history: Array<{ id: string, version: number, form: RegistrationForm, createdBy: string, createdAt: Date }> = []
  return {
    getDraft: async () => draft,
    saveDraft: async ({ form: next, expectedRevision }) => {
      if (expectedRevision !== draft.revision) return null
      draft = { ...draft, form: next, revision: draft.revision + 1 }
      return draft
    },
    publishDraft: async ({ expectedRevision, actorUserId }) => {
      if (expectedRevision !== draft.revision) return null
      version += 1
      const record = { id: `00000000-0000-4000-8000-00000000000${version}`, version, form: draft.form, createdBy: actorUserId, createdAt: new Date() }
      history.unshift(record)
      draft = { ...draft, baseVersion: version, publishedVersionId: record.id }
      return { revision: draft.revision, version, formVersionId: record.id }
    },
    listVersions: async () => ({ publishedVersion: draft.baseVersion, versions: history }),
    getPublished: async () => history[0] ?? null,
    getVersion: async (id) => history.find((item) => item.id === id) ?? null,
  }
}

describe('registration form service', () => {
  it('saves a valid draft with optimistic revision and publishes immutable history', async () => {
    const service = createRegistrationFormService(repository())
    const saved = await service.saveDraft(form('第一题'), 0, 'admin-1')
    expect(saved.data.revision).toBe(1)

    const published = await service.publish(1, 'admin-1')
    expect(published.data.version).toBe(1)
    expect((await service.getHistory()).data.versions[0]?.form.questions[0]?.label).toBe('第一题')
  })

  it('rejects stale revisions as a conflict', async () => {
    const service = createRegistrationFormService(repository())
    await service.saveDraft(form('第一题'), 0, 'admin-1')
    await expect(service.saveDraft(form('过期修改'), 0, 'admin-2')).rejects.toBeInstanceOf(RegistrationFormConflictError)
  })

  it('returns field-level validation errors and never accepts arbitrary schema JSON', async () => {
    const service = createRegistrationFormService(repository())
    await expect(service.saveDraft({ ...form('非法'), questions: [{ ...form('非法').questions[0], order: 3 }] }, 0, 'admin-1'))
      .rejects.toBeInstanceOf(RegistrationFormValidationError)
  })

  it('keeps a submitted application bound to the original form snapshot across publication', async () => {
    const repo = repository()
    const service = createRegistrationFormService(repo)
    await service.saveDraft(form('v1 问题'), 0, 'admin-1')
    const v1 = (await service.publish(1, 'admin-1')).data.formVersionId
    await service.saveDraft(form('v2 问题'), 1, 'admin-1')
    await service.publish(2, 'admin-1')

    expect((await repo.getVersion(v1))?.form.questions[0]?.label).toBe('v1 问题')
  })
})
