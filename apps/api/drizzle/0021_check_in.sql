CREATE TABLE IF NOT EXISTS "check_in_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid NOT NULL,
  "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "revision" integer NOT NULL DEFAULT 0,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "check_in_credentials_application_id_unique" UNIQUE ("application_id"),
  CONSTRAINT "check_in_credentials_public_id_unique" UNIQUE ("public_id"),
  CONSTRAINT "check_in_credentials_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "check_in_credentials_application_id_applications_id_fk"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "check_in_credentials_application_id_idx" ON "check_in_credentials" ("application_id");
CREATE INDEX IF NOT EXISTS "check_in_credentials_public_id_idx" ON "check_in_credentials" ("public_id");

CREATE TABLE IF NOT EXISTS "check_ins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid NOT NULL,
  "credential_id" uuid NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "confirmed_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_by" uuid NOT NULL,
  "revoked_at" timestamptz,
  "revoked_by" uuid,
  "revoke_reason" text,
  "revision" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "check_ins_application_id_unique" UNIQUE ("application_id"),
  CONSTRAINT "check_ins_credential_id_unique" UNIQUE ("credential_id"),
  CONSTRAINT "check_ins_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "check_ins_active_state_check" CHECK (NOT "active" OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL)),
  CONSTRAINT "check_ins_revocation_state_check" CHECK ("active" OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL AND "revoke_reason" IS NOT NULL AND char_length(btrim("revoke_reason")) >= 2)),
  CONSTRAINT "check_ins_application_id_applications_id_fk"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE,
  CONSTRAINT "check_ins_credential_id_check_in_credentials_id_fk"
    FOREIGN KEY ("credential_id") REFERENCES "check_in_credentials"("id") ON DELETE CASCADE,
  CONSTRAINT "check_ins_confirmed_by_users_id_fk"
    FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "check_ins_revoked_by_users_id_fk"
    FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "check_ins_active_idx" ON "check_ins" ("active");
CREATE INDEX IF NOT EXISTS "check_ins_application_id_idx" ON "check_ins" ("application_id");
