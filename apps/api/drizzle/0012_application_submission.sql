CREATE TABLE "user_profiles" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "organization" text NOT NULL,
  "department" text NOT NULL,
  "identity_type" text NOT NULL,
  "education_stage" text NOT NULL,
  "major_research_direction" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "applications" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;
ALTER TABLE "applications" ADD CONSTRAINT "applications_revision_check" CHECK ("revision" >= 0);
ALTER TABLE "application_files" ADD COLUMN "attachment_slot" uuid;
UPDATE "application_files" SET "attachment_slot" = gen_random_uuid() WHERE "attachment_slot" IS NULL;
ALTER TABLE "application_files" ALTER COLUMN "attachment_slot" SET NOT NULL;
ALTER TABLE "application_files" ADD CONSTRAINT "application_files_application_slot_unique" UNIQUE("application_id", "attachment_slot");
ALTER TABLE "files" DROP CONSTRAINT "files_attachment_slot_check";
ALTER TABLE "files" ADD CONSTRAINT "files_attachment_slot_check" CHECK (
  "attachment_slot" IS NULL OR "attachment_slot" ~ '^(?:[a-z][a-z0-9_-]{0,63}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
);

CREATE OR REPLACE FUNCTION prevent_application_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'application versions are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER application_versions_immutable_update BEFORE UPDATE ON "application_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_application_version_mutation();
CREATE TRIGGER application_versions_immutable_delete BEFORE DELETE ON "application_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_application_version_mutation();
