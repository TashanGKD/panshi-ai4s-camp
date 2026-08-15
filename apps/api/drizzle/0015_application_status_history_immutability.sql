CREATE OR REPLACE FUNCTION reject_application_status_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'application status history is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS application_status_history_immutable ON "application_status_history";
CREATE TRIGGER application_status_history_immutable
BEFORE UPDATE OR DELETE ON "application_status_history"
FOR EACH ROW EXECUTE FUNCTION reject_application_status_history_mutation();
