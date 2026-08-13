ALTER TABLE "content_modules"
  DROP CONSTRAINT "content_modules_published_version_id_content_versions_id_fk";

ALTER TABLE "content_versions"
  ADD CONSTRAINT "content_versions_module_key_id_unique" UNIQUE ("module_key", "id");

ALTER TABLE "content_modules"
  ADD CONSTRAINT "content_modules_published_version_content_versions_fk"
  FOREIGN KEY ("key", "published_version_id")
  REFERENCES "content_versions"("module_key", "id")
  ON DELETE RESTRICT;

ALTER TABLE "audit_logs"
  DROP CONSTRAINT "audit_logs_actor_user_id_users_id_fk";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT;
