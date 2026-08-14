import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import type { JsonObject, RegistrationForm } from '@panshi/contracts'

type UserRole = 'user' | 'admin'
type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'reviewing'
  | 'needs_supplement'
  | 'admitted'
  | 'waitlisted'
  | 'rejected'
type ResourceAccess = 'public' | 'authenticated' | 'admitted'
type VerificationPurpose = 'register' | 'reset_password'
type VerificationDeliveryState = 'pending' | 'sent' | 'failed'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  phoneNormalized: text('phone_normalized').notNull().unique('users_phone_normalized_unique'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<UserRole>().notNull().default('user'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  check('users_display_name_check', sql`char_length(btrim(${table.displayName})) > 0`),
  check('users_phone_normalized_check', sql`${table.phoneNormalized} ~ '^\\+861[3-9][0-9]{9}$'`),
  check('users_role_check', sql`${table.role} in ('user', 'admin')`),
])

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique('sessions_token_hash_unique'),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
  index('sessions_expires_at_idx').on(table.expiresAt),
])

export const verificationCodes = pgTable('verification_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNormalized: text('phone_normalized').notNull(),
  purpose: text('purpose').$type<VerificationPurpose>().notNull(),
  deliveryState: text('delivery_state').$type<VerificationDeliveryState>().notNull().default('pending'),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  createdAt: createdAt(),
}, (table) => [
  check('verification_codes_purpose_check', sql`${table.purpose} in ('register', 'reset_password')`),
  check('verification_codes_delivery_state_check', sql`${table.deliveryState} in ('pending', 'sent', 'failed')`),
  check('verification_codes_failed_attempts_check', sql`${table.failedAttempts} >= 0`),
  index('verification_codes_phone_active_created_idx')
    .on(table.phoneNormalized, table.createdAt.desc())
    .where(sql`${table.deliveryState} in ('pending', 'sent')`),
  index('verification_codes_phone_purpose_sent_created_idx')
    .on(table.phoneNormalized, table.purpose, table.createdAt.desc())
    .where(sql`${table.deliveryState} = 'sent'`),
])

export const contentModules = pgTable('content_modules', {
  key: text('key').primaryKey(),
  draft: jsonb('draft').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  draftRevision: integer('draft_revision').notNull().default(0),
  publishedVersionId: uuid('published_version_id'),
}, (table) => [
  check('content_modules_draft_revision_check', sql`${table.draftRevision} >= 0`),
  foreignKey({
    name: 'content_modules_published_version_content_versions_fk',
    columns: [table.key, table.publishedVersionId],
    foreignColumns: [contentVersions.moduleKey, contentVersions.id],
  }).onDelete('restrict'),
])

export const contentVersions = pgTable('content_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleKey: text('module_key').notNull().references(
    (): AnyPgColumn => contentModules.key,
    { onDelete: 'restrict' },
  ),
  version: integer('version').notNull(),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
}, (table) => [
  unique('content_versions_module_key_version_unique').on(table.moduleKey, table.version),
  unique('content_versions_module_key_id_unique').on(table.moduleKey, table.id),
  check('content_versions_version_check', sql`${table.version} > 0`),
])

export const registrationFormVersions = pgTable('registration_form_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  schema: jsonb('schema').$type<JsonObject>().notNull(),
  version: integer('version').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique('registration_form_versions_version_unique').on(table.version),
  check('registration_form_versions_version_check', sql`${table.version} > 0`),
])

export const registrationFormDrafts = pgTable('registration_form_drafts', {
  id: uuid('id').primaryKey(),
  schema: jsonb('schema').$type<RegistrationForm>().notNull(),
  revision: integer('revision').notNull().default(0),
  publishedRevision: integer('published_revision').notNull().default(0),
  baseVersionId: uuid('base_version_id').references(() => registrationFormVersions.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('registration_form_drafts_revision_check', sql`${table.revision} >= 0`),
  check('registration_form_drafts_published_revision_check', sql`${table.publishedRevision} >= 0`),
])

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }).unique('applications_user_id_unique'),
  formVersionId: uuid('form_version_id').notNull().references(
    () => registrationFormVersions.id,
    { onDelete: 'restrict' },
  ),
  status: text('status').$type<ApplicationStatus>().notNull().default('draft'),
  coreFields: jsonb('core_fields').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  answers: jsonb('answers').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('applications_status_check', sql`${table.status} in (
    'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'
  )`),
  index('applications_status_idx').on(table.status),
])

export const applicationVersions = pgTable('application_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  snapshot: jsonb('snapshot').$type<JsonObject>().notNull(),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
}, (table) => [
  index('application_versions_application_id_idx').on(table.applicationId),
])

export const applicationStatusHistory = pgTable('application_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status').$type<ApplicationStatus>(),
  toStatus: text('to_status').$type<ApplicationStatus>().notNull(),
  changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason'),
  createdAt: createdAt(),
}, (table) => [
  check('application_status_history_from_status_check', sql`${table.fromStatus} is null or ${table.fromStatus} in (
    'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'
  )`),
  check('application_status_history_to_status_check', sql`${table.toStatus} in (
    'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'
  )`),
  index('application_status_history_application_id_idx').on(table.applicationId, table.createdAt),
])

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  storageKey: text('storage_key').notNull().unique('files_storage_key_unique'),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  createdAt: createdAt(),
}, (table) => [
  check('files_size_bytes_check', sql`${table.sizeBytes} >= 0`),
])

export const applicationFiles = pgTable('application_files', {
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'restrict' }),
  purpose: text('purpose').notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ name: 'application_files_pkey', columns: [table.applicationId, table.fileId] }),
  index('application_files_file_id_idx').on(table.fileId),
])

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique('resources_key_unique'),
  title: text('title').notNull(),
  description: text('description'),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'restrict' }),
  accessLevel: text('access_level').$type<ResourceAccess>().notNull().default('public'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (table) => [
  check('resources_access_level_check', sql`${table.accessLevel} in ('public', 'authenticated', 'admitted')`),
  check('resources_sort_order_check', sql`${table.sortOrder} >= 0`),
  index('resources_access_level_sort_order_idx').on(table.accessLevel, table.sortOrder),
])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (table) => [
  index('audit_logs_actor_user_id_idx').on(table.actorUserId),
  index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  index('audit_logs_created_at_idx').on(table.createdAt),
])

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<JsonObject>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
