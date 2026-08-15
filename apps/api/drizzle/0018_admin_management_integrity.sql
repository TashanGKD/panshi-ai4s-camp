CREATE UNIQUE INDEX "users_admin_display_name_unique"
ON "users" (lower(btrim("display_name")))
WHERE "role" = 'admin';

CREATE FUNCTION "preserve_last_active_administrator"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."role" <> 'admin' OR OLD."disabled_at" IS NOT NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."role" = 'admin' AND NEW."disabled_at" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('panshi_admin_management'));
  IF NOT EXISTS (
    SELECT 1 FROM "users"
    WHERE "role" = 'admin' AND "disabled_at" IS NULL AND "id" <> OLD."id"
  ) THEN
    RAISE EXCEPTION 'cannot remove the last active administrator';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "users_preserve_last_active_administrator"
BEFORE UPDATE OF "role", "disabled_at" OR DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION "preserve_last_active_administrator"();
