ALTER TABLE "registration_form_versions"
  ADD COLUMN "version" integer DEFAULT 1,
  ADD COLUMN "created_by" uuid;

WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "published_at", "created_at", "id")::integer AS "version"
  FROM "registration_form_versions"
)
UPDATE "registration_form_versions" AS versions
SET "version" = numbered."version"
FROM numbered
WHERE versions."id" = numbered."id";

ALTER TABLE "registration_form_versions"
  ALTER COLUMN "version" SET NOT NULL,
  ADD CONSTRAINT "registration_form_versions_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "registration_form_versions_version_unique" UNIQUE ("version"),
  ADD CONSTRAINT "registration_form_versions_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;

CREATE TABLE "registration_form_drafts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "schema" jsonb NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "base_version_id" uuid,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "registration_form_drafts_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "registration_form_drafts_base_version_fk"
    FOREIGN KEY ("base_version_id") REFERENCES "registration_form_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "registration_form_drafts_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "registration_form_drafts" ("id", "schema") VALUES (
  '00000000-0000-4000-8000-000000000010',
  '{
    "coreFields": [
      {"key":"name","label":"姓名","required":true,"readOnly":false},
      {"key":"phone","label":"手机号","required":true,"readOnly":true},
      {"key":"email","label":"电子邮箱","required":true,"readOnly":false},
      {"key":"organization","label":"所在单位","required":true,"readOnly":false},
      {"key":"department","label":"院系/部门","required":true,"readOnly":false},
      {"key":"identityType","label":"身份类型","required":true,"readOnly":false},
      {"key":"educationStage","label":"学历阶段","required":true,"readOnly":false},
      {"key":"majorResearchDirection","label":"专业及研究方向","required":true,"readOnly":false}
    ],
    "questions": [],
    "attachments": [{
      "id":"00000000-0000-4000-8000-000000000001",
      "label":"个人简历／补充材料",
      "helpText":"支持 PDF、DOCX，单个文件不超过 10 MB。",
      "required":false,
      "order":0,
      "active":true,
      "allowedExtensions":["pdf","docx"],
      "maxSizeBytes":10485760
    }]
  }'::jsonb
);

CREATE OR REPLACE FUNCTION "reject_immutable_row_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME IN ('content_versions', 'registration_form_versions') THEN
    RAISE EXCEPTION '% are immutable', TG_TABLE_NAME;
  END IF;

  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

CREATE TRIGGER "registration_form_versions_immutable"
BEFORE UPDATE OR DELETE ON "registration_form_versions"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();
