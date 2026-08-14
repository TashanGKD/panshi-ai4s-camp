ALTER TABLE "files" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;
ALTER TABLE "files" ADD COLUMN "delete_failure_code" text;
UPDATE "files" SET "lifecycle_state" = 'deleted' WHERE "deleted_at" IS NOT NULL;
ALTER TABLE "files" ADD CONSTRAINT "files_lifecycle_state_check"
  CHECK ("lifecycle_state" IN ('active', 'deleting', 'delete_failed', 'deleted'));
ALTER TABLE "files" ADD CONSTRAINT "files_delete_failure_state_check"
  CHECK (("lifecycle_state" = 'delete_failed') = ("delete_failure_code" IS NOT NULL));
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_state_check"
  CHECK (("lifecycle_state" = 'deleted') = ("deleted_at" IS NOT NULL));
CREATE INDEX "files_lifecycle_state_idx" ON "files" ("lifecycle_state");

CREATE TABLE "file_storage_recoveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "storage_key" text NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "state" text DEFAULT 'pending' NOT NULL,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "file_storage_recoveries_storage_key_unique" UNIQUE("storage_key"),
  CONSTRAINT "file_storage_recoveries_state_check" CHECK ("state" IN ('pending', 'delete_failed')),
  CONSTRAINT "file_storage_recoveries_failure_state_check"
    CHECK (("state" = 'delete_failed') = ("failure_code" IS NOT NULL))
);
CREATE INDEX "file_storage_recoveries_state_idx" ON "file_storage_recoveries" ("state", "updated_at");
