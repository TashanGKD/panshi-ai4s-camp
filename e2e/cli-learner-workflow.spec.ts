import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { isRegistrationQuestionVisible, type RegistrationForm } from '@panshi/contracts'
import { createDatabaseClient } from '../apps/api/src/db/client'
import { applications, confirmationIntents, files, resources } from '../apps/api/src/db/schema'
import { runCli } from '../apps/cli/dist/main.js'
import { KeychainCredentialStore, type CredentialStore } from '../apps/cli/dist/credentials.js'

const apiBase = 'http://127.0.0.1:3023'
const adminOrigin = 'http://127.0.0.1:4196'
const databaseUrl = 'postgresql://boyuan@127.0.0.1:5432/panshi_ai4s_camp_test'
const pdf = Buffer.from('JVBERi0xLjcKJcOiw6PDj8OTCjEgMCBvYmoKPDwgL1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDIgMCBSID4+CmVuZG9iagoyIDAgb2JqCjw8IC9UeXBlIC9QYWdlcyAvS2lkcyBbXSAvQ291bnQgMCA+PgplbmRvYmoKeHJlZgowIDMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAzIC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxMjAKJSVFT0YK', 'base64')

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>()
  async get(profile: string) { return this.values.get(profile) ?? null }
  async set(profile: string, token: string) { this.values.set(profile, token) }
  async delete(profile: string) { this.values.delete(profile) }
}

// The CLI envelope is contract-checked in its package; this E2E intentionally traverses heterogeneous command payloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CliDocument = { ok: boolean, code?: string, data?: any, details?: any, capabilityId?: string }

const answerForm = (form: RegistrationForm) => {
  const answers: Record<string, unknown> = {}
  for (const question of form.questions.filter(({ active }) => active)) {
    if (!isRegistrationQuestionVisible(question, answers)) continue
    if (question.type === 'short_text' || question.type === 'long_text') {
      answers[question.id] = question.required ? 'CLI 端到端测试回答' : ''
    } else if (question.type === 'single_choice') {
      answers[question.id] = question.options[0]!.value
    } else if (question.type === 'multiple_choice') {
      const openPractice = question.options.find(({ value }) => value === 'open-practice')
      const count = Math.max(question.validation.minSelections ?? (question.required ? 1 : 0), 1)
      answers[question.id] = openPractice ? [openPractice.value] : question.options.slice(0, count).map(({ value }) => value)
    } else {
      answers[question.id] = {
        ratings: Object.fromEntries(question.items.map(({ value }) => [value, question.levels[1]!.value])),
        otherLabel: '', otherLevel: '',
      }
    }
  }
  return answers
}

test('built CLI completes the public, registration, review and admitted learner workflow without a browser', async () => {
  test.setTimeout(180_000)
  const root = await mkdtemp(join(tmpdir(), 'panshi-cli-e2e-'))
  const credentials = new MemoryCredentialStore()
  const phone = process.env.E2E_REGISTER_PHONE!
  const password = process.env.E2E_REGISTER_PASSWORD!
  const code = process.env.E2E_VERIFICATION_CODE!

  const invoke = async (command: string[], options: { secrets?: Record<string, string>, stdin?: string, store?: CredentialStore, baseUrl?: string } = {}) => {
    const stdout: string[] = []; const stderr: string[] = []
    const networkErrors: unknown[] = []
    const exitCode = await runCli([
      '--json', '--base-url', options.baseUrl ?? apiBase, ...command,
    ], {
      stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value),
      fetch: async (input, init) => {
        const response = await fetch(input, init)
        if (!response.ok) networkErrors.push(await response.clone().json().catch(() => ({ status: response.status })))
        return response
      },
      credentialStore: options.store ?? credentials, homeDirectory: root, workspaceRoot: root,
      stdin: async () => options.stdin ?? '', readSecrets: async () => ({ ...options.secrets }),
      promptText: async () => { throw new Error('CLI E2E must not prompt') },
      readSecret: async () => { throw new Error('CLI E2E must not prompt') },
    })
    expect(stdout).toHaveLength(1)
    const document = JSON.parse(stdout[0]!) as CliDocument
    return { exitCode, document, stdout: stdout.join(''), stderr: stderr.join(''), networkErrors }
  }

  const confirmed = async (command: string[], options: { secrets?: Record<string, string>, stdin?: string } = {}) => {
    const prepared = await invoke(command, options)
    expect(prepared.document).toMatchObject({ ok: false, code: 'CONFIRMATION_REQUIRED' })
    const context = prepared.document.details as { confirmationId: string, clientBinding: string, idempotencyKey: string }
    const executed = await invoke([...command,
      '--confirmation-id', context.confirmationId,
      '--client-binding', context.clientBinding,
      '--idempotency-key', context.idempotencyKey,
    ], options)
    return { prepared, context, executed }
  }

  for (const command of [
    ['info', 'show'], ['content', 'get', 'basic'], ['schedule', 'list'], ['travel', 'show'], ['contacts', 'show'],
    ['institutions', 'search', '中国科学院'], ['application', 'form'], ['application-count', 'show'], ['resources', 'list'],
  ]) {
    const result = await invoke(command)
    expect(result.exitCode, command.join(' ')).toBe(0)
    expect(result.document.ok).toBe(true)
  }

  const verification = await confirmed(['auth', 'verification', 'send', '--phone', phone, '--purpose', 'register'])
  expect(verification.executed.exitCode, JSON.stringify(verification.executed.document)).toBe(0)
  const replayedVerification = await invoke([
    'auth', 'verification', 'send', '--phone', phone, '--purpose', 'register',
    '--confirmation-id', verification.context.confirmationId,
    '--client-binding', verification.context.clientBinding,
    '--idempotency-key', verification.context.idempotencyKey,
  ])
  expect(replayedVerification.document).toMatchObject({ ok: true, data: { accepted: true } })

  expect((await confirmed(['auth', 'register', '--phone', phone], { secrets: { code, password } })).executed.exitCode).toBe(0)
  expect((await confirmed(['auth', 'login', '--phone', phone], { secrets: { password } })).executed.exitCode).toBe(0)
  expect((await invoke(['auth', 'status'])).document.ok).toBe(true)

  const initial = await invoke(['application', 'show'])
  const application = initial.document.data.application
  const body = {
    expectedRevision: application.revision,
    profile: {
      name: 'CLI 学员', email: 'cli-e2e@example.test', organization: '中国科学院物理研究所', department: '研究生部',
      identityType: '博士研究生', educationStage: '博士', majorResearchDirection: '凝聚态物理与人工智能辅助科学',
      major: '凝聚态物理', researchInterest: '', researchDirection: '凝聚态物理与人工智能辅助科学', postdocStation: '', disciplineField: '', supervisor: '',
      jobPosition: '', professionalTitleLevel: '', specificTitle: '', identityDescription: '',
    },
    answers: answerForm(application.form), attachments: [],
  }
  expect((await invoke(['application', 'validate', '--input', '-'], { stdin: JSON.stringify(body) })).document.data.valid).toBe(true)

  const stalePrepare = await invoke(['application', 'draft', 'save', '--input', '-'], { stdin: JSON.stringify(body) })
  expect(stalePrepare.document.code).toBe('CONFIRMATION_REQUIRED')
  const firstSave = await confirmed(['application', 'draft', 'save', '--input', '-'], { stdin: JSON.stringify(body) })
  expect(firstSave.executed.exitCode).toBe(0)
  const stale = stalePrepare.document.details
  const staleExecute = await invoke([
    'application', 'draft', 'save', '--input', '-', '--confirmation-id', stale.confirmationId,
    '--client-binding', stale.clientBinding, '--idempotency-key', stale.idempotencyKey,
  ], { stdin: JSON.stringify(body) })
  expect(staleExecute.document.code).toBe('APPLICATION_REVISION_CONFLICT')

  const resumePath = join(root, 'resume.pdf')
  await writeFile(resumePath, pdf)
  const slotId = application.form.attachments.find(({ active }: { active: boolean }) => active)!.id
  const changedPrepare = await invoke(['files', 'upload', resumePath, '--slot', slotId])
  expect(changedPrepare.document.code).toBe('CONFIRMATION_REQUIRED')
  await writeFile(resumePath, Buffer.concat([pdf, Buffer.from('\nchanged')]))
  const changed = changedPrepare.document.details
  const changedExecute = await invoke([
    'files', 'upload', resumePath, '--slot', slotId, '--confirmation-id', changed.confirmationId,
    '--client-binding', changed.clientBinding, '--idempotency-key', changed.idempotencyKey,
  ])
  expect(changedExecute.document.code).toBe('CONFIRMATION_MISMATCH')

  await writeFile(resumePath, pdf)
  const uploaded = await confirmed(['files', 'upload', resumePath, '--slot', slotId])
  expect(uploaded.executed.exitCode).toBe(0)
  const fileId = uploaded.executed.document.data.file.id
  const latest = (await invoke(['application', 'show'])).document.data.application
  const attachedBody = { ...body, expectedRevision: latest.revision, attachments: [{ slotId, fileId }] }
  expect((await confirmed(['application', 'draft', 'save', '--input', '-'], { stdin: JSON.stringify(attachedBody) })).executed.exitCode).toBe(0)
  const submitted = await confirmed(['application', 'submit'])
  expect(submitted.executed.exitCode, JSON.stringify({ document: submitted.executed.document, networkErrors: submitted.executed.networkErrors })).toBe(0)

  const submittedState = await invoke(['application', 'show'])
  expect(submittedState.document.data.application.status).toBe('submitted')
  expect(submittedState.document.data.timeline.map(({ status }: { status: string }) => status)).toContain('submitted')

  const adminLogin = await fetch(`${apiBase}/api/v1/auth/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: adminOrigin },
    body: JSON.stringify({ phone: '+8613999999999', password: process.env.E2E_ADMIN_PASSWORD }),
  })
  expect(adminLogin.status).toBe(200)
  const cookie = adminLogin.headers.get('set-cookie')!.split(';', 1)[0]!
  const adminJson = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${apiBase}${path}`, { ...init, headers: { Cookie: cookie, Origin: adminOrigin, ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers } })
    return { response, body: await response.json() }
  }

  const resourceForm = new FormData()
  resourceForm.append('purpose', 'resource'); resourceForm.append('visibility', 'admitted')
  resourceForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'admitted-guide.pdf')
  const resourceUpload = await adminJson('/api/v1/files', { method: 'POST', body: resourceForm })
  expect(resourceUpload.response.status).toBe(201)
  const resourceDraft = await adminJson('/api/v1/admin/resources', { method: 'POST', body: JSON.stringify({
    key: 'cli-admitted-guide', title: 'CLI 录取学员指南', description: '仅录取学员可访问',
    fileId: resourceUpload.body.data.file.id, accessScope: 'admitted', sortOrder: 99, expectedRevision: 0,
  }) })
  const resourceId = resourceDraft.body.data.resource.id
  const resourcePublish = await adminJson(`/api/v1/admin/resources/${resourceId}/publish`, { method: 'POST', body: JSON.stringify({ expectedRevision: resourceDraft.body.data.resource.revision }) })
  expect(resourcePublish.response.status).toBe(200)
  const deniedResource = await invoke(['resources', 'download', resourceId, '--output', join(root, 'denied.pdf')])
  expect(deniedResource.document.code, JSON.stringify(deniedResource.networkErrors)).toBe('RESOURCE_NOT_FOUND')

  const appId = submittedState.document.data.application.id
  let revision = submittedState.document.data.application.revision
  for (const targetStatus of ['reviewing', 'admitted']) {
    const transition = await adminJson(`/api/v1/admin/applications/${appId}/status`, { method: 'POST', body: JSON.stringify({ expectedRevision: revision, targetStatus, editableFieldIds: [], editableAttachmentIds: [] }) })
    expect(transition.response.status).toBe(200)
    revision = transition.body.data.revision
  }
  const verificationDb = createDatabaseClient(databaseUrl)
  try {
    const [applicationRecord] = await verificationDb.db.select({ userId: applications.userId, status: applications.status }).from(applications).where(eq(applications.id, appId)).limit(1)
    const [resourceRecord] = await verificationDb.db.select({ active: resources.active, accessLevel: resources.accessLevel, fileId: resources.fileId }).from(resources).where(eq(resources.id, resourceId)).limit(1)
    const [resourceFile] = await verificationDb.db.select({ purpose: files.purpose, visibility: files.visibility, lifecycleState: files.lifecycleState, hiddenAt: files.hiddenAt, deletedAt: files.deletedAt }).from(files).where(eq(files.id, resourceRecord!.fileId!)).limit(1)
    const sessionUser = (await invoke(['auth', 'status'])).document.data.user
    expect(applicationRecord).toMatchObject({ userId: sessionUser.id, status: 'admitted' })
    expect(resourceRecord).toMatchObject({ active: true, accessLevel: 'admitted' })
    expect(resourceFile).toMatchObject({ purpose: 'resource', visibility: 'admitted', lifecycleState: 'active', hiddenAt: null, deletedAt: null })
  } finally { await verificationDb.close() }
  expect((await invoke(['resources', 'list'])).document.data.resources.map(({ id }: { id: string }) => id)).toContain(resourceId)

  const expiredPrepare = await invoke(['auth', 'logout'])
  expect(expiredPrepare.document.code).toBe('CONFIRMATION_REQUIRED')
  const db = createDatabaseClient(databaseUrl)
  try {
    await db.db.update(confirmationIntents).set({ expiresAt: new Date(0) }).where(eq(confirmationIntents.id, expiredPrepare.document.details.confirmationId))
  } finally { await db.close() }
  const expired = expiredPrepare.document.details
  const expiredExecute = await invoke(['auth', 'logout', '--confirmation-id', expired.confirmationId, '--client-binding', expired.clientBinding, '--idempotency-key', expired.idempotencyKey])
  expect(expiredExecute.document.code).toBe('CONFIRMATION_EXPIRED')

  const checkIn = await invoke(['check-in', 'show'])
  expect(checkIn.document.data).toMatchObject({ availability: 'available', qrPayload: '[REDACTED]' })
  const qrPath = join(root, 'check-in.gif')
  const qr = await invoke(['check-in', 'qr', 'export', '--output', qrPath])
  expect(qr.exitCode).toBe(0)
  expect(qr.stdout + qr.stderr).not.toContain('qrPayload')
  expect((await readFile(qrPath)).length).toBeGreaterThan(0)
  expect((await invoke(['check-in', 'qr', 'export', '--output', qrPath])).document.code).toBe('OUTPUT_EXISTS')

  const unavailableStore = new KeychainCredentialStore({
    getPassword: async () => { throw new Error('unavailable') }, setPassword: async () => undefined, deletePassword: async () => undefined,
  })
  expect((await invoke(['auth', 'status'], { store: unavailableStore })).document.code).toBe('KEYCHAIN_UNAVAILABLE')
  expect((await invoke(['info', 'show'], { baseUrl: 'http://127.0.0.1:65534' })).document.code).toBe('SERVICE_UNAVAILABLE')

  expect((await confirmed(['auth', 'logout'])).executed.exitCode).toBe(0)
  expect((await invoke(['application', 'show'])).document.code).toBe('UNAUTHORIZED')
})
