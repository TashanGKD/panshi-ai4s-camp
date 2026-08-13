ALTER TABLE "users" ADD COLUMN "display_name" text;
UPDATE "users" SET "display_name" = "phone_normalized" WHERE "display_name" IS NULL;
ALTER TABLE "users" ALTER COLUMN "display_name" SET NOT NULL;
