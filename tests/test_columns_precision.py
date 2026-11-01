"""Writer must preserve float32 bits; NULL remains distinct from valid zero."""
import csv
import gzip
import numpy as np
from src.solver import write_columns

def test_columns_roundtrip_float32_bits(tmp_path):
    rng = np.random.default_rng(812)
    values = np.concatenate(([0, 0.0230344, 0.0485567, np.finfo(np.float32).tiny, np.finfo(np.float32).max], 10 ** rng.uniform(-8, 3, 10000))).astype(np.float32)
    field = values.reshape(-1, 1, 1)
    path = tmp_path / "columns.csv.gz"
    write_columns(path, field)
    # One deliberately long column exercises 10,005 distinct float32 values.
    limit = csv.field_size_limit(1_000_000)
    try:
        with gzip.open(path, "rt") as stream:
            row = next(csv.DictReader(stream))
    finally:
        csv.field_size_limit(limit)
    restored = np.array(row["c_ug_m3"][1:-1].split(","), dtype=np.float32)
    np.testing.assert_array_equal(restored.view(np.uint32), values.view(np.uint32))

def test_null_and_zero_are_distinct(tmp_path):
    path = tmp_path / "columns.csv.gz"
    write_columns(path, np.array([np.nan, 0, 1.23456789], dtype=np.float32).reshape(3, 1, 1))
    with gzip.open(path, "rt") as stream:
        text = next(csv.DictReader(stream))["c_ug_m3"]
    assert text.startswith("{NULL,0,")
