CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone_normalized" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text DEFAULT 'user' NOT NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_phone_normalized_unique" UNIQUE("phone_normalized"),
  CONSTRAINT "users_role_check" CHECK ("role" IN ('user', 'admin'))
);

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "user_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

CREATE TABLE "verification_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone_normalized" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "verification_codes_failed_attempts_check" CHECK ("failed_attempts" >= 0)
);

CREATE INDEX "verification_codes_phone_expires_idx" ON "verification_codes" ("phone_normalized", "expires_at");

CREATE TABLE "content_modules" (
  "key" text PRIMARY KEY NOT NULL,
  "draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "draft_revision" integer DEFAULT 0 NOT NULL,
  "published_version_id" uuid,
  CONSTRAINT "content_modules_draft_revision_check" CHECK ("draft_revision" >= 0)
);

CREATE TABLE "content_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_key" text NOT NULL,
  "version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_versions_module_key_version_unique" UNIQUE("module_key", "version"),
  CONSTRAINT "content_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "content_versions_module_key_content_modules_key_fk" FOREIGN KEY ("module_key") REFERENCES "content_modules"("key") ON DELETE RESTRICT,
  CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT
);

ALTER TABLE "content_modules"
  ADD CONSTRAINT "content_modules_published_version_id_content_versions_id_fk"
  FOREIGN KEY ("published_version_id") REFERENCES "content_versions"("id") ON DELETE RESTRICT;

CREATE TABLE "registration_form_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schema" jsonb NOT NULL,
  "published_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "form_version_id" uuid NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "core_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "applications_user_id_unique" UNIQUE("user_id"),
  CONSTRAINT "applications_status_check" CHECK ("status" IN (
    'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'
  )),
  CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "applications_form_version_id_registration_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "registration_form_versions"("id") ON DELETE RESTRICT
);

CREATE INDEX "applications_status_idx" ON "applications" ("status");

CREATE TABLE "application_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid NOT NULL,
  "snapshot" jsonb NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "application_versions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE
);

CREATE INDEX "application_versions_application_id_idx" ON "application_versions" ("application_id");

CREATE TABLE "application_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "changed_by" uuid,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "application_status_history_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN (
    'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'
  )),
  CONSTRAINT "application_status_history_to_status_check" CHECK ("to_status" IN (
    'draft', 'submitted', 'reviewing', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'
  )),
  CONSTRAINT "application_status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
  CONSTRAINT "application_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "application_status_history_application_id_idx" ON "application_status_history" ("application_id", "created_at");

CREATE TABLE "files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "storage_key" text NOT NULL,
  "original_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key"),
  CONSTRAINT "files_size_bytes_check" CHECK ("size_bytes" >= 0)
);

CREATE TABLE "application_files" (
  "application_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "purpose" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "application_files_pkey" PRIMARY KEY ("application_id", "file_id"),
  CONSTRAINT "application_files_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
  CONSTRAINT "application_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT
);

CREATE INDEX "application_files_file_id_idx" ON "application_files" ("file_id");

CREATE TABLE "resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "file_id" uuid,
  "access_level" text DEFAULT 'public' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "resources_key_unique" UNIQUE("key"),
  CONSTRAINT "resources_access_level_check" CHECK ("access_level" IN ('public', 'authenticated', 'admitted')),
  CONSTRAINT "resources_sort_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "resources_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT
);

CREATE INDEX "resources_access_level_sort_order_idx" ON "resources" ("access_level", "sort_order");

CREATE TABLE "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" ("actor_user_id");
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" ("entity_type", "entity_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" ("created_at");

CREATE TABLE "system_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE FUNCTION "reject_immutable_row_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'content_versions' THEN
    RAISE EXCEPTION 'content_versions are immutable';
  END IF;

  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

CREATE TRIGGER "content_versions_immutable"
BEFORE UPDATE OR DELETE ON "content_versions"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();
