ALTER TABLE "sessions"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'web';

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_kind_check"
  CHECK ("kind" IN ('web', 'cli', 'admin_web', 'admin_cli'));

CREATE INDEX "sessions_user_kind_active_idx"
  ON "sessions" ("user_id", "kind")
  WHERE "revoked_at" IS NULL;
