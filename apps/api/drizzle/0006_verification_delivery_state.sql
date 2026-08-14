ALTER TABLE "verification_codes"
  ADD COLUMN "delivery_state" text;

UPDATE "verification_codes"
SET "delivery_state" = 'sent'
WHERE "delivery_state" IS NULL;

ALTER TABLE "verification_codes"
  ALTER COLUMN "delivery_state" SET DEFAULT 'pending',
  ALTER COLUMN "delivery_state" SET NOT NULL;

ALTER TABLE "verification_codes"
  ADD CONSTRAINT "verification_codes_delivery_state_check"
  CHECK ("delivery_state" IN ('pending', 'sent', 'failed'));

DROP INDEX "verification_codes_phone_purpose_created_idx";
DROP INDEX "verification_codes_phone_created_idx";

CREATE INDEX "verification_codes_phone_active_created_idx"
  ON "verification_codes" ("phone_normalized", "created_at" DESC)
  WHERE "delivery_state" IN ('pending', 'sent');

CREATE INDEX "verification_codes_phone_purpose_sent_created_idx"
  ON "verification_codes" ("phone_normalized", "purpose", "created_at" DESC)
  WHERE "delivery_state" = 'sent';
