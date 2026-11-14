-- REST and spatial SQL read height k at PostgreSQL array index k + 1.
ALTER TABLE concentration_columns ADD CONSTRAINT concentration_columns_one_based_nonempty
    CHECK ((array_ndims(c_ug_m3) = 1 AND array_lower(c_ug_m3, 1) = 1
            AND cardinality(c_ug_m3) > 0) IS TRUE);

-- SQL CHECK accepts UNKNOWN, so require a definite result for partial pairs.
ALTER TABLE grid_cells ADD CONSTRAINT grid_cells_solid_pair_complete
    CHECK ((solid_from_k IS NULL) = (solid_to_k IS NULL));
