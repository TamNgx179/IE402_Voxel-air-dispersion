-- Row triggers never fire for TRUNCATE, so 0005's published-result immutability
-- could be bypassed by truncating a result table (directly or by CASCADE from
-- simulation_runs), leaving succeeded runs without columns, metrics, checks or
-- artifacts. Whole-run DELETE remains the supported cleanup path.
-- TRUNCATE holds ACCESS EXCLUSIVE before BEFORE TRUNCATE triggers run, and this
-- READ COMMITTED query sees any publication that committed while it waited.
CREATE FUNCTION protect_published_results_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM simulation_runs WHERE status='succeeded') THEN
    RAISE EXCEPTION 'Published run results are immutable; TRUNCATE % refused',TG_TABLE_NAME
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['simulation_runs','concentration_columns','run_metrics',
    'verification_checks','artifacts'] LOOP
    EXECUTE format('CREATE TRIGGER protect_published_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION protect_published_results_truncate()',t);
  END LOOP;
END; $$;
