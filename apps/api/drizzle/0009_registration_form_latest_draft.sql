WITH latest AS (
  SELECT "id", "schema"
  FROM "registration_form_versions"
  ORDER BY "version" DESC
  LIMIT 1
)
UPDATE "registration_form_drafts" AS draft
SET "schema" = latest."schema",
    "base_version_id" = latest."id"
FROM latest
WHERE draft."base_version_id" IS NULL;

ALTER TABLE "registration_form_drafts"
  ALTER COLUMN "published_revision" DROP DEFAULT,
  ALTER COLUMN "published_revision" DROP NOT NULL,
  DROP CONSTRAINT "registration_form_drafts_published_revision_check";

UPDATE "registration_form_drafts"
SET "published_revision" = NULL
WHERE "base_version_id" IS NULL;

UPDATE "registration_form_drafts" AS draft
SET "published_revision" = CASE
  WHEN draft."schema" = version."schema" THEN draft."revision"
  ELSE NULL
END
FROM "registration_form_versions" AS version
WHERE version."id" = draft."base_version_id";

ALTER TABLE "registration_form_drafts"
  ADD CONSTRAINT "registration_form_drafts_published_revision_check"
  CHECK (
    "published_revision" IS NULL
    OR ("published_revision" >= 0 AND "published_revision" <= "revision")
  );
