ALTER TABLE "resources" ADD COLUMN "active" boolean DEFAULT true NOT NULL;
ALTER TABLE "resources" ADD COLUMN "published_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "resources" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE INDEX "resources_active_scope_sort_idx" ON "resources" ("active", "access_level", "sort_order", "id");
