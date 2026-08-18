CREATE TABLE "confirmation_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "site_id" text NOT NULL DEFAULT 'panshi-ai4s-camp',
  "capability_id" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "payload" jsonb NOT NULL,
  "preview" jsonb NOT NULL,
  "target_type" text,
  "target_id" text,
  "expected_revision" integer,
  "client_binding_digest" text NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "safe_result" jsonb,
  "result_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  CONSTRAINT "confirmation_intents_site_id_check" CHECK ("site_id" = 'panshi-ai4s-camp'),
  CONSTRAINT "confirmation_intents_payload_sha256_check" CHECK ("payload_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "confirmation_intents_client_binding_check" CHECK ("client_binding_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "confirmation_intents_revision_check" CHECK ("expected_revision" IS NULL OR "expected_revision" >= 0),
  CONSTRAINT "confirmation_intents_status_check" CHECK ("status" IN ('pending', 'executing', 'consumed', 'expired', 'failed')),
  CONSTRAINT "confirmation_intents_consumed_state_check" CHECK (("status" = 'consumed') = ("consumed_at" IS NOT NULL AND "safe_result" IS NOT NULL))
);
CREATE UNIQUE INDEX "confirmation_intents_actor_idempotency_unique"
  ON "confirmation_intents" ("actor_user_id", "idempotency_key") WHERE "actor_user_id" IS NOT NULL;
CREATE UNIQUE INDEX "confirmation_intents_anonymous_idempotency_unique"
  ON "confirmation_intents" ("client_binding_digest", "idempotency_key") WHERE "actor_user_id" IS NULL;
CREATE INDEX "confirmation_intents_actor_status_idx" ON "confirmation_intents" ("actor_user_id", "status");
CREATE INDEX "confirmation_intents_status_expiry_idx" ON "confirmation_intents" ("status", "expires_at");
