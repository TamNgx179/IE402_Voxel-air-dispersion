-- 0001_init.sql — schema v1 (docs/DATABASE.md §1–§2, docs/spec.md "Hợp đồng v1").
--
-- Applied by app/src/database/migrate.ts inside one transaction and recorded in
-- schema_migrations. Never edit an applied migration: add 0002_*.sql instead
-- (the runner refuses a migration whose checksum changed).
--
-- Every geometry is stored in the projected CRS of the single MVP study area,
-- EPSG:32648 (UTM 48N), fixed in the column type (DATABASE.md §2).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid() is core since PG13; kept for older servers

-- ------------------------------------------------------------------
-- Study area and scene (seeded from db/seeds/scene/, DATABASE.md §5)
-- ------------------------------------------------------------------

CREATE TABLE study_areas (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL UNIQUE,
    geom           geometry(Polygon, 32648) NOT NULL,
    -- Must equal the SRID fixed in every geometry column type of this schema.
    projected_srid integer NOT NULL DEFAULT 32648 CHECK (projected_srid = 32648),
    grid           jsonb NOT NULL,
    scene_version  text,
    provenance     jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- geom's SRID is enforced by the typed column. No CHECK on ST_SRID(geom):
    -- PostGIS's geometry_columns view parses such constraints and breaks.
    CONSTRAINT study_areas_geom_valid CHECK (ST_IsValid(geom)),
    CONSTRAINT study_areas_grid_keys CHECK (
        grid ?& ARRAY['origin_x_m', 'origin_y_m', 'dx_m', 'dy_m', 'dz_m', 'nx', 'ny', 'nz']
    )
);
CREATE INDEX study_areas_geom_gist ON study_areas USING gist (geom);

CREATE TABLE building_footprints (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    study_area_id     uuid NOT NULL REFERENCES study_areas (id) ON DELETE CASCADE,
    source_feature_id text NOT NULL,
    geom              geometry(MultiPolygon, 32648) NOT NULL,
    height_m          real NOT NULL CHECK (height_m > 0),
    height_source     text NOT NULL
        -- Same vocabulary as the Python pipeline (src/00_prepare_osm_data.py,
        -- src/voxel/heights.py): provenance is stored as produced, never translated.
        CHECK (height_source IN ('gob:building_height', 'osm:height', 'osm:building:levels', 'fallback:fixed')),
    CONSTRAINT building_footprints_geom_valid CHECK (ST_IsValid(geom))
);
CREATE INDEX building_footprints_geom_gist ON building_footprints USING gist (geom);
CREATE INDEX building_footprints_study_area_idx ON building_footprints (study_area_id);

CREATE TABLE road_segments (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    study_area_id     uuid NOT NULL REFERENCES study_areas (id) ON DELETE CASCADE,
    source_feature_id text NOT NULL,
    geom              geometry(LineString, 32648) NOT NULL,
    road_class        text,
    emission_weight   real CHECK (emission_weight >= 0)
);
CREATE INDEX road_segments_geom_gist ON road_segments USING gist (geom);
CREATE INDEX road_segments_study_area_idx ON road_segments (study_area_id);

-- Water and green layers come from the scene package (water.csv, green.csv;
-- spec BR-33). They are display-only, so the geometry type is left open
-- (polygons for water bodies/parks, lines for waterways) but the SRID is fixed.
CREATE TABLE water_features (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    study_area_id     uuid NOT NULL REFERENCES study_areas (id) ON DELETE CASCADE,
    source_feature_id text NOT NULL,
    kind              text,
    geom              geometry(Geometry, 32648) NOT NULL,
    CONSTRAINT water_features_geom_valid CHECK (ST_IsValid(geom))
);
CREATE INDEX water_features_geom_gist ON water_features USING gist (geom);
CREATE INDEX water_features_study_area_idx ON water_features (study_area_id);

CREATE TABLE green_features (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    study_area_id     uuid NOT NULL REFERENCES study_areas (id) ON DELETE CASCADE,
    source_feature_id text NOT NULL,
    kind              text,
    geom              geometry(Geometry, 32648) NOT NULL,
    CONSTRAINT green_features_geom_valid CHECK (ST_IsValid(geom))
);
CREATE INDEX green_features_geom_gist ON green_features USING gist (geom);
CREATE INDEX green_features_study_area_idx ON green_features (study_area_id);

CREATE TABLE grid_cells (
    study_area_id uuid NOT NULL REFERENCES study_areas (id) ON DELETE CASCADE,
    i             smallint NOT NULL CHECK (i >= 0),
    j             smallint NOT NULL CHECK (j >= 0),
    geom          geometry(Polygon, 32648) NOT NULL,
    solid_from_k  smallint,
    solid_to_k    smallint,
    PRIMARY KEY (study_area_id, i, j),
    CONSTRAINT grid_cells_solid_pair CHECK (
        (solid_from_k IS NULL AND solid_to_k IS NULL)
        OR (solid_from_k >= 0 AND solid_to_k >= solid_from_k)
    )
);
CREATE INDEX grid_cells_geom_gist ON grid_cells USING gist (geom);

-- ------------------------------------------------------------------
-- Configuration-derived tables (config/project.yaml, BR-40)
-- ------------------------------------------------------------------

CREATE TABLE scenarios (
    id             text PRIMARY KEY,
    study_area_id  uuid NOT NULL REFERENCES study_areas (id) ON DELETE RESTRICT,
    name           text NOT NULL,
    wind_from_deg  real NOT NULL CHECK (wind_from_deg >= 0 AND wind_from_deg < 360),
    wind_speed_m_s real NOT NULL CHECK (wind_speed_m_s >= 0),
    parameters     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX scenarios_study_area_idx ON scenarios (study_area_id);

CREATE TABLE thresholds (
    key         text PRIMARY KEY,
    value_ug_m3 real NOT NULL CHECK (value_ug_m3 > 0),
    label       text NOT NULL,
    config_hash text NOT NULL
);

-- ------------------------------------------------------------------
-- Runs (BR-16..BR-21, spec D2)
-- ------------------------------------------------------------------

CREATE TABLE simulation_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id     text NOT NULL REFERENCES scenarios (id) ON DELETE RESTRICT,
    model           text NOT NULL DEFAULT 'fv' CHECK (model IN ('fv', 'gaussian')),
    status          text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'stale')),
    attempt         smallint NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    config_snapshot jsonb,
    model_version   text,
    input_hash      text,
    -- Copied from the manifest; a mock run is always flagged here (BR-30).
    warnings        text[] NOT NULL DEFAULT '{}',
    progress        real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    error_kind      text CHECK (error_kind IN ('input', 'model', 'system', 'timeout')),
    error_message   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,
    CONSTRAINT simulation_runs_failed_has_kind CHECK (status <> 'failed' OR error_kind IS NOT NULL),
    CONSTRAINT simulation_runs_succeeded_complete CHECK (
        status <> 'succeeded'
        OR (model_version IS NOT NULL AND input_hash IS NOT NULL AND finished_at IS NOT NULL)
    )
);
-- Executor picks the oldest queued run; restart scans running runs.
CREATE INDEX simulation_runs_status_created_idx ON simulation_runs (status, created_at);
CREATE INDEX simulation_runs_scenario_idx ON simulation_runs (scenario_id);
-- Runs with equal inputs share input_hash: that is reproducibility evidence,
-- not a duplicate. A retry reuses its own row, so it never duplicates (BR-19).
CREATE INDEX simulation_runs_input_hash_idx ON simulation_runs (input_hash);

CREATE TABLE run_metrics (
    run_id             uuid PRIMARY KEY REFERENCES simulation_runs (id) ON DELETE CASCADE,
    dt_s               real,
    courant            real,
    steps              integer,
    simulated_s        real,
    wall_clock_s       real,
    emitted_kg         double precision,
    remaining_kg       double precision,
    escaped_kg         double precision,
    correction_kg      double precision,
    stopping_criterion text CHECK (stopping_criterion IN ('fixed_time', 'steady_state'))
);

CREATE TABLE verification_checks (
    run_id     uuid NOT NULL REFERENCES simulation_runs (id) ON DELETE CASCADE,
    check_name text NOT NULL CHECK (check_name IN (
        'cfl', 'face_divergence', 'positivity', 'wall_flux', 'mass_balance', 'sor_convergence'
    )),
    status     text NOT NULL CHECK (status IN ('pass', 'fail')),
    value      double precision,
    tolerance  double precision CHECK (tolerance >= 0),
    PRIMARY KEY (run_id, check_name)
);

CREATE TABLE artifacts (
    run_id     uuid NOT NULL REFERENCES simulation_runs (id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN (
        'wind', 'concentration', 'columns', 'metrics', 'log', 'config', 'manifest'
    )),
    path       text NOT NULL,
    sha256     text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    PRIMARY KEY (run_id, kind)
);

-- One row per voxel column (spec D1). NULL elements are solid voxels.
CREATE TABLE concentration_columns (
    run_id  uuid NOT NULL REFERENCES simulation_runs (id) ON DELETE CASCADE,
    i       smallint NOT NULL CHECK (i >= 0),
    j       smallint NOT NULL CHECK (j >= 0),
    c_ug_m3 real[] NOT NULL CHECK (array_ndims(c_ug_m3) = 1 AND array_length(c_ug_m3, 1) >= 1),
    PRIMARY KEY (run_id, i, j)
);

-- array_length(c_ug_m3, 1) = nz and (i, j) inside the grid of the run's study
-- area. A CHECK cannot read other tables, so this is a trigger (DATABASE.md §2).
CREATE FUNCTION concentration_columns_check_grid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    g jsonb;
BEGIN
    SELECT sa.grid INTO g
    FROM simulation_runs r
    JOIN scenarios s ON s.id = r.scenario_id
    JOIN study_areas sa ON sa.id = s.study_area_id
    WHERE r.id = NEW.run_id;

    IF g IS NULL THEN
        RAISE EXCEPTION 'concentration_columns: run % has no study area grid', NEW.run_id;
    END IF;
    IF array_length(NEW.c_ug_m3, 1) <> (g ->> 'nz')::int THEN
        RAISE EXCEPTION 'concentration_columns: array_length(c_ug_m3, 1) = % but nz = %',
            array_length(NEW.c_ug_m3, 1), g ->> 'nz';
    END IF;
    IF NEW.i >= (g ->> 'nx')::int OR NEW.j >= (g ->> 'ny')::int THEN
        RAISE EXCEPTION 'concentration_columns: (i, j) = (%, %) outside grid % x %',
            NEW.i, NEW.j, g ->> 'nx', g ->> 'ny';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER concentration_columns_check_grid
    BEFORE INSERT OR UPDATE ON concentration_columns
    FOR EACH ROW EXECUTE FUNCTION concentration_columns_check_grid();
