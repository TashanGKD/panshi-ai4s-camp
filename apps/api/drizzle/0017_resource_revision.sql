ALTER TABLE "resources" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;
ALTER TABLE "resources" ADD CONSTRAINT "resources_revision_check" CHECK ("revision" >= 0);
