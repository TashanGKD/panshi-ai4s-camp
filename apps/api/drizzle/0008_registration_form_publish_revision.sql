ALTER TABLE "registration_form_drafts"
  ADD COLUMN "published_revision" integer;

UPDATE "registration_form_drafts"
SET "published_revision" = CASE
  WHEN "base_version_id" IS NULL THEN 0
  ELSE "revision"
END;

ALTER TABLE "registration_form_drafts"
  ALTER COLUMN "published_revision" SET DEFAULT 0,
  ALTER COLUMN "published_revision" SET NOT NULL,
  ADD CONSTRAINT "registration_form_drafts_published_revision_check" CHECK ("published_revision" >= 0);
