-- 既有迁移已创建默认报名表草稿；首次上线时将该草稿发布为不可变版本，
-- 使学员端可以直接创建和保存报名信息。已有发布版本的环境保持不变。
WITH draft_to_publish AS (
  SELECT "id", "schema", "revision"
  FROM "registration_form_drafts"
  WHERE "base_version_id" IS NULL
  FOR UPDATE
), inserted AS (
  INSERT INTO "registration_form_versions" ("id", "schema", "version", "published_at")
  SELECT
    '00000000-0000-4000-8000-000000000020'::uuid,
    draft_to_publish."schema",
    COALESCE((SELECT max("version") FROM "registration_form_versions"), 0) + 1,
    now()
  FROM draft_to_publish
  RETURNING "id"
)
UPDATE "registration_form_drafts" AS drafts
SET
  "base_version_id" = inserted."id",
  "published_revision" = drafts."revision",
  "updated_at" = now()
FROM inserted
WHERE drafts."id" = '00000000-0000-4000-8000-000000000010';
