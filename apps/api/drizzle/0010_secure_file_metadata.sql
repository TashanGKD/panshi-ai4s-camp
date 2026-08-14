ALTER TABLE "files" ADD COLUMN "uploaded_by" uuid;
ALTER TABLE "files" ADD COLUMN "owner_user_id" uuid;
ALTER TABLE "files" ADD COLUMN "purpose" text DEFAULT 'legacy' NOT NULL;
ALTER TABLE "files" ADD COLUMN "visibility" text DEFAULT 'owner_admin' NOT NULL;
ALTER TABLE "files" ADD COLUMN "attachment_slot" text;
ALTER TABLE "files" ADD COLUMN "hidden_at" timestamp with time zone;
ALTER TABLE "files" ADD COLUMN "deleted_at" timestamp with time zone;

ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "files" ADD CONSTRAINT "files_sha256_check"
  CHECK ("sha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check"
  CHECK ("purpose" IN ('registration_attachment', 'resource', 'legacy'));
ALTER TABLE "files" ADD CONSTRAINT "files_visibility_check"
  CHECK ("visibility" IN ('owner_admin', 'public', 'authenticated', 'admitted'));
ALTER TABLE "files" ADD CONSTRAINT "files_attachment_slot_check"
  CHECK ("attachment_slot" IS NULL OR "attachment_slot" ~ '^[a-z][a-z0-9_-]{0,63}$');

CREATE INDEX "files_owner_user_id_idx" ON "files" ("owner_user_id");
CREATE INDEX "files_uploaded_by_idx" ON "files" ("uploaded_by");
