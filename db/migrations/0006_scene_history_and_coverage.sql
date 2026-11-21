-- Freeze the single-revision scientific scene once a run references it.
-- Statement locks precede row locks, including the first-run/scene-write race.
-- This protects ordinary SQL writers, not a superuser disabling triggers.
CREATE FUNCTION lock_scene_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A retained REPEATABLE READ snapshot could miss a run committed while
  -- waiting for the advisory lock. Fail closed outside the supported writer mode.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Scientific writes require READ COMMITTED' USING ERRCODE='25001';
  END IF;
  PERFORM pg_advisory_xact_lock(4020003);
  IF TG_OP='TRUNCATE' AND EXISTS(SELECT 1 FROM simulation_runs) THEN
    RAISE EXCEPTION 'Scientific scene is frozen by existing runs' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['study_areas','grid_cells','building_footprints',
    'road_segments','water_features','green_features','scenarios','thresholds'] LOOP
    EXECUTE format('CREATE TRIGGER scene_history_lock BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION lock_scene_history()',t);
  END LOOP;
END; $$;
CREATE TRIGGER run_scene_history_lock BEFORE INSERT OR UPDATE OF scenario_id ON simulation_runs
  FOR EACH STATEMENT EXECUTE FUNCTION lock_scene_history();

CREATE FUNCTION protect_scene_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_area uuid; new_area uuid; used boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='thresholds' THEN
    SELECT EXISTS(SELECT 1 FROM simulation_runs) INTO used;
  ELSIF TG_TABLE_NAME='scenarios' THEN
    -- A new scenario may reuse a frozen scene. An existing run's scenario cannot drift.
    IF TG_OP<>'INSERT' THEN
      SELECT EXISTS(SELECT 1 FROM simulation_runs WHERE scenario_id=OLD.id) INTO used;
    END IF;
  ELSE
    IF TG_TABLE_NAME='study_areas' THEN
      IF TG_OP<>'INSERT' THEN old_area:=OLD.id; END IF;
      IF TG_OP<>'DELETE' THEN new_area:=NEW.id; END IF;
    ELSE
      IF TG_OP<>'INSERT' THEN old_area:=OLD.study_area_id; END IF;
      IF TG_OP<>'DELETE' THEN new_area:=NEW.study_area_id; END IF;
    END IF;
    SELECT EXISTS(SELECT 1 FROM simulation_runs r JOIN scenarios s ON s.id=r.scenario_id
      WHERE s.study_area_id IN (old_area,new_area)) INTO used;
  END IF;
  IF used THEN
    RAISE EXCEPTION 'Scientific scene % is frozen by existing runs',TG_TABLE_NAME USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['study_areas','grid_cells','building_footprints',
    'road_segments','water_features','green_features','scenarios','thresholds'] LOOP
    EXECUTE format('CREATE TRIGGER protect_scene_history BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_scene_history()',t);
  END LOOP;
END; $$;

-- Complete is the production default. Partial scientific datasets must opt in
-- explicitly through an administrative import, never through a create-run DTO.
ALTER TABLE simulation_runs ADD COLUMN coverage_policy text NOT NULL DEFAULT 'complete'
  CHECK (coverage_policy IN ('complete','partial'));

CREATE FUNCTION assert_run_coverage(run_ uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE policy text;
BEGIN
  SELECT coverage_policy INTO policy FROM simulation_runs WHERE id=run_;
  IF EXISTS (
    SELECT 1 FROM concentration_columns c
    JOIN grid_cells g ON (g.study_area_id,g.i,g.j)=(c.study_area_id,c.i,c.j)
    CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY v(value,k)
    WHERE c.run_id=run_ AND (
      (v.k-1 BETWEEN g.solid_from_k AND g.solid_to_k AND v.value IS NOT NULL)
      OR (policy='complete' AND v.value IS NULL
          AND (g.solid_from_k IS NULL OR v.k-1 NOT BETWEEN g.solid_from_k AND g.solid_to_k)))) THEN
    RAISE EXCEPTION 'Run % violates its air coverage or solid mask',run_ USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM concentration_columns c
    JOIN grid_cells g ON (g.study_area_id,g.i,g.j)=(c.study_area_id,c.i,c.j)
    CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY v(value,k)
    WHERE c.run_id=run_ AND v.value IS NOT NULL
      AND (g.solid_from_k IS NULL OR v.k-1 NOT BETWEEN g.solid_from_k AND g.solid_to_k)) THEN
    RAISE EXCEPTION 'Run % has no valid air sample',run_ USING ERRCODE='23514';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION assert_run_publishable(run_ uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE expected bigint;
BEGIN
  SELECT (a.grid->>'nx')::bigint*(a.grid->>'ny')::bigint INTO expected
    FROM simulation_runs r JOIN scenarios s ON s.id=r.scenario_id
    JOIN study_areas a ON a.id=s.study_area_id WHERE r.id=run_;
  IF expected IS NULL OR (SELECT count(*) FROM concentration_columns WHERE run_id=run_)<>expected
     OR NOT EXISTS (SELECT 1 FROM run_metrics WHERE run_id=run_)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cfl','face_divergence','positivity','wall_flux','mass_balance']) n
                WHERE NOT EXISTS (SELECT 1 FROM verification_checks c WHERE c.run_id=run_ AND c.check_name=n AND c.status='pass'))
     OR EXISTS (SELECT 1 FROM verification_checks WHERE run_id=run_ AND status<>'pass')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['config','wind','concentration','columns','metrics','log','manifest']) n
                WHERE NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.run_id=run_ AND a.kind=n)) THEN
    RAISE EXCEPTION 'Run % cannot be published: incomplete columns, metrics, checks or artifacts',run_ USING ERRCODE='23514';
  END IF;
  PERFORM assert_run_coverage(run_);
END; $$;

CREATE FUNCTION protect_published_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='succeeded' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Published run % metadata is immutable',OLD.id USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_published_run BEFORE UPDATE ON simulation_runs
  FOR EACH ROW EXECUTE FUNCTION protect_published_run();

-- Audit, never repair or silently relabel historical scientific data.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM simulation_runs WHERE status='succeeded' LOOP
    PERFORM assert_run_publishable(r.id);
  END LOOP;
END; $$;
