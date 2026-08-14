ALTER TABLE "verification_codes"
  ADD COLUMN "purpose" text;

UPDATE "verification_codes"
SET "purpose" = 'register'
WHERE "purpose" IS NULL;

ALTER TABLE "verification_codes"
  ALTER COLUMN "purpose" SET NOT NULL;

ALTER TABLE "verification_codes"
  ADD CONSTRAINT "verification_codes_purpose_check"
  CHECK ("purpose" IN ('register', 'reset_password'));

DROP INDEX "verification_codes_phone_expires_idx";

CREATE INDEX "verification_codes_phone_purpose_created_idx"
  ON "verification_codes" ("phone_normalized", "purpose", "created_at" DESC);

CREATE INDEX "verification_codes_phone_created_idx"
  ON "verification_codes" ("phone_normalized", "created_at" DESC);
