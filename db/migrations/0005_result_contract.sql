-- Enforce the scientific storage/publication contract for ordinary SQL writers.
-- Existing invalid data aborts this migration; never silently repair model output.
CREATE FUNCTION voxel_grid_valid(g jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE key text; v numeric;
BEGIN
  FOREACH key IN ARRAY ARRAY['origin_x_m','origin_y_m','dx_m','dy_m','dz_m','nx','ny','nz'] LOOP
    IF jsonb_typeof(g->key) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    v := (g->>key)::numeric;
    IF key IN ('dx_m','dy_m','dz_m') AND v <= 0 THEN RETURN false; END IF;
    IF key IN ('nx','ny','nz') AND (v < 1 OR v > 32768 OR v <> trunc(v)) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END; $$;
ALTER TABLE study_areas ADD CONSTRAINT study_areas_grid_values CHECK (voxel_grid_valid(grid));

CREATE FUNCTION concentration_values_valid(values_ real[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM unnest(values_) v
                    WHERE v IS NOT NULL AND NOT (v >= 0 AND v < 'Infinity'::real));
$$;
ALTER TABLE concentration_columns ADD CONSTRAINT concentration_columns_finite_nonnegative
  CHECK (concentration_values_valid(c_ug_m3));

-- The area is a derived physical key. The trigger derives it from the run,
-- while the composite FK supplies PostgreSQL's concurrent delete protection.
ALTER TABLE concentration_columns ADD COLUMN study_area_id uuid;
UPDATE concentration_columns c SET study_area_id = s.study_area_id
  FROM simulation_runs r JOIN scenarios s ON s.id = r.scenario_id WHERE r.id = c.run_id;
ALTER TABLE concentration_columns ALTER COLUMN study_area_id SET NOT NULL;
ALTER TABLE concentration_columns ADD CONSTRAINT concentration_columns_grid_fk
  FOREIGN KEY (study_area_id,i,j) REFERENCES grid_cells(study_area_id,i,j) ON DELETE RESTRICT;
CREATE INDEX concentration_columns_grid_idx ON concentration_columns(study_area_id,i,j);

CREATE OR REPLACE FUNCTION concentration_columns_check_grid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE g jsonb; area uuid;
BEGIN
  -- A column's identity is stable. Moving rows between runs would also create
  -- opposing parent-lock orders for concurrent updates.
  IF TG_OP='UPDATE' AND (NEW.run_id,NEW.i,NEW.j) IS DISTINCT FROM (OLD.run_id,OLD.i,OLD.j) THEN
    RAISE EXCEPTION 'Concentration column identity cannot be changed' USING ERRCODE='23514';
  END IF;
  SELECT sa.grid,sa.id INTO g,area
    FROM simulation_runs r JOIN scenarios s ON s.id=r.scenario_id
    JOIN study_areas sa ON sa.id=s.study_area_id WHERE r.id=NEW.run_id
    FOR UPDATE OF r FOR SHARE OF s,sa;
  IF g IS NULL THEN RAISE EXCEPTION 'concentration_columns: run % has no study area grid', NEW.run_id; END IF;
  IF NEW.study_area_id IS NOT NULL AND NEW.study_area_id <> area THEN
    RAISE EXCEPTION 'concentration_columns: study area does not match run' USING ERRCODE='23514';
  END IF;
  NEW.study_area_id := area;
  IF array_length(NEW.c_ug_m3,1) <> (g->>'nz')::int THEN
    RAISE EXCEPTION 'concentration_columns: array_length must equal nz = %',g->>'nz';
  END IF;
  IF NEW.i >= (g->>'nx')::int OR NEW.j >= (g->>'ny')::int THEN
    RAISE EXCEPTION 'concentration_columns: column outside grid';
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION grid_cells_check_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g jsonb;
BEGIN
  SELECT grid INTO g FROM study_areas WHERE id=NEW.study_area_id FOR SHARE;
  IF NEW.i >= (g->>'nx')::int OR NEW.j >= (g->>'ny')::int
     OR NEW.solid_to_k >= (g->>'nz')::int THEN
    RAISE EXCEPTION 'grid_cells: indices or solid range outside grid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER grid_cells_check_bounds BEFORE INSERT OR UPDATE ON grid_cells
  FOR EACH ROW EXECUTE FUNCTION grid_cells_check_bounds();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM grid_cells g JOIN study_areas a ON a.id=g.study_area_id
    WHERE g.i >= (a.grid->>'nx')::int OR g.j >= (a.grid->>'ny')::int
       OR g.solid_to_k >= (a.grid->>'nz')::int) THEN
    RAISE EXCEPTION 'Existing grid indices are outside the scene dimensions';
  END IF;
END; $$;

ALTER TABLE building_footprints ADD CONSTRAINT building_height_finite CHECK (height_m < 'Infinity'::real);
ALTER TABLE road_segments ADD CONSTRAINT road_weight_finite CHECK (emission_weight < 'Infinity'::real);
ALTER TABLE scenarios ADD CONSTRAINT scenario_wind_finite CHECK (wind_speed_m_s < 'Infinity'::real);
ALTER TABLE thresholds ADD CONSTRAINT threshold_finite CHECK (value_ug_m3 < 'Infinity'::real);
ALTER TABLE road_segments ADD CONSTRAINT road_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom) AND ST_Length(geom)>0);
ALTER TABLE grid_cells ADD CONSTRAINT grid_geometry_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom) AND ST_Area(geom)>0);
ALTER TABLE verification_checks ADD CONSTRAINT verification_numbers_finite CHECK (
  (value IS NULL OR (value > '-Infinity'::float8 AND value < 'Infinity'::float8))
  AND (tolerance IS NULL OR tolerance < 'Infinity'::float8));
ALTER TABLE simulation_runs ADD CONSTRAINT succeeded_progress_complete
  CHECK (status<>'succeeded' OR progress=1);

-- Validate a publication once, after its child rows have been inserted.
-- File checksums are verified by the application: SQL can validate metadata,
-- but does not make the filesystem part of the database transaction.
CREATE FUNCTION assert_run_publishable(run_ uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE expected bigint;
BEGIN
  SELECT (a.grid->>'nx')::bigint*(a.grid->>'ny')::bigint INTO expected
    FROM simulation_runs r JOIN scenarios s ON s.id=r.scenario_id
    JOIN study_areas a ON a.id=s.study_area_id WHERE r.id=run_;
  IF expected IS NULL OR (SELECT count(*) FROM concentration_columns WHERE run_id=run_) <> expected
     OR NOT EXISTS (SELECT 1 FROM run_metrics WHERE run_id=run_)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cfl','face_divergence','positivity','wall_flux','mass_balance']) n
                WHERE NOT EXISTS (SELECT 1 FROM verification_checks c WHERE c.run_id=run_ AND c.check_name=n AND c.status='pass'))
     OR EXISTS (SELECT 1 FROM verification_checks WHERE run_id=run_ AND status<>'pass')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['config','wind','concentration','columns','metrics','log','manifest']) n
                WHERE NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.run_id=run_ AND a.kind=n)) THEN
    RAISE EXCEPTION 'Run % cannot be published: incomplete columns, metrics, checks or artifacts',run_ USING ERRCODE='23514';
  END IF;
END; $$;
CREATE FUNCTION simulation_runs_check_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.scenario_id IS DISTINCT FROM OLD.scenario_id
    AND EXISTS (SELECT 1 FROM concentration_columns c JOIN scenarios s ON s.id=NEW.scenario_id
                WHERE c.run_id=NEW.id AND c.study_area_id<>s.study_area_id) THEN
    RAISE EXCEPTION 'Cannot move existing concentrations to another study area' USING ERRCODE='23514';
  END IF;
  -- Leave the original metadata CHECK responsible for its own diagnostic.
  IF NEW.status='succeeded' AND NEW.model_version IS NOT NULL
     AND NEW.input_hash IS NOT NULL AND NEW.finished_at IS NOT NULL THEN
    PERFORM assert_run_publishable(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER simulation_runs_check_publication BEFORE INSERT OR UPDATE ON simulation_runs
  FOR EACH ROW EXECUTE FUNCTION simulation_runs_check_publication();

CREATE FUNCTION protect_published_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_run uuid; new_run uuid; r record;
BEGIN
  IF TG_OP<>'INSERT' THEN old_run:=OLD.run_id; END IF;
  IF TG_OP<>'DELETE' THEN new_run:=NEW.run_id; END IF;
  -- Lock both parents in a stable order. This serializes child writes with a
  -- concurrent publication without blocking legitimate cascading parent deletion.
  FOR r IN SELECT id,status FROM simulation_runs WHERE id IN (old_run,new_run) ORDER BY id FOR UPDATE LOOP
    IF r.status='succeeded' THEN
      RAISE EXCEPTION 'Published run % results are immutable',r.id USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_published_columns BEFORE INSERT OR UPDATE OR DELETE ON concentration_columns
  FOR EACH ROW EXECUTE FUNCTION protect_published_result();
CREATE TRIGGER protect_published_metrics BEFORE INSERT OR UPDATE OR DELETE ON run_metrics
  FOR EACH ROW EXECUTE FUNCTION protect_published_result();
CREATE TRIGGER protect_published_checks BEFORE INSERT OR UPDATE OR DELETE ON verification_checks
  FOR EACH ROW EXECUTE FUNCTION protect_published_result();
CREATE TRIGGER protect_published_artifacts BEFORE INSERT OR UPDATE OR DELETE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION protect_published_result();

-- A run's scene mapping must not drift behind the derived concentration FK.
CREATE FUNCTION protect_run_scene() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='scenarios' THEN
    IF NEW.study_area_id IS DISTINCT FROM OLD.study_area_id AND EXISTS (SELECT 1 FROM simulation_runs WHERE scenario_id=OLD.id) THEN
      RAISE EXCEPTION 'A scenario used by runs cannot change study area' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.grid IS DISTINCT FROM OLD.grid AND EXISTS (SELECT 1 FROM scenarios s JOIN simulation_runs r ON r.scenario_id=s.id WHERE s.study_area_id=OLD.id) THEN
      RAISE EXCEPTION 'A grid used by runs cannot change dimensions' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_scenario_area BEFORE UPDATE ON scenarios FOR EACH ROW EXECUTE FUNCTION protect_run_scene();
CREATE TRIGGER protect_study_area_grid BEFORE UPDATE ON study_areas FOR EACH ROW EXECUTE FUNCTION protect_run_scene();

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM simulation_runs WHERE status='succeeded' LOOP PERFORM assert_run_publishable(r.id); END LOOP;
END; $$;
