CREATE TABLE "sms_notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_key" text NOT NULL,
  "event_type" text NOT NULL,
  "application_id" uuid NOT NULL REFERENCES "applications"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "phone_normalized" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "biz_id" text,
  "provider_request_id" text,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accepted_at" timestamp with time zone,
  CONSTRAINT "sms_notification_outbox_event_key_check" CHECK (char_length(btrim("event_key")) > 0),
  CONSTRAINT "sms_notification_outbox_event_type_check" CHECK ("event_type" IN (
    'application_submitted', 'needs_supplement', 'admitted', 'waitlisted', 'rejected'
  )),
  CONSTRAINT "sms_notification_outbox_phone_check" CHECK ("phone_normalized" ~ '^1[3-9][0-9]{9}$'),
  CONSTRAINT "sms_notification_outbox_status_check" CHECK ("status" IN (
    'pending', 'processing', 'retry_wait', 'accepted', 'dead_letter'
  )),
  CONSTRAINT "sms_notification_outbox_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "sms_notification_outbox_lock_state_check" CHECK (("status" = 'processing') = ("locked_at" IS NOT NULL)),
  CONSTRAINT "sms_notification_outbox_accepted_state_check" CHECK (
    ("status" = 'accepted') = ("accepted_at" IS NOT NULL AND "biz_id" IS NOT NULL)
  ),
  CONSTRAINT "sms_notification_outbox_dead_letter_state_check" CHECK (
    "status" <> 'dead_letter' OR "last_error_code" IS NOT NULL
  )
);

ALTER TABLE "sms_notification_outbox"
  ADD CONSTRAINT "sms_notification_outbox_event_key_unique" UNIQUE ("event_key");
CREATE INDEX "sms_notification_outbox_ready_idx"
  ON "sms_notification_outbox" ("status", "available_at", "id");
CREATE INDEX "sms_notification_outbox_application_idx"
  ON "sms_notification_outbox" ("application_id", "created_at");
