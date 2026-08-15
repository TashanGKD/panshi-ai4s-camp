ALTER TABLE "applications" ADD COLUMN "supplement_public_message" text;
ALTER TABLE "applications" ADD COLUMN "supplement_deadline" timestamptz;
ALTER TABLE "applications" ADD COLUMN "supplement_editable_field_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "applications" ADD COLUMN "supplement_editable_attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "applications" ADD COLUMN "internal_review_note" text;
ALTER TABLE "applications" ADD CONSTRAINT "applications_supplement_message_check"
  CHECK ("status" <> 'needs_supplement' OR char_length(btrim("supplement_public_message")) > 0);
CREATE INDEX "applications_submitted_at_idx" ON "applications" ("submitted_at", "id");
