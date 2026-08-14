ALTER TABLE "users"
  ADD CONSTRAINT "users_display_name_check"
  CHECK (char_length(btrim("display_name")) > 0);

ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_normalized_check"
  CHECK ("phone_normalized" ~ '^\+861[3-9][0-9]{9}$');
