"""B9.5 - count roof-shape tags for the study-area buildings.

The prepared file data/raw/buildings.geojson keeps only height-related OSM
columns, so roof tags (roof:shape, roof:height, ...) are not stored locally.
This script:

1. counts every roof/height-related key present in the local GeoJSON;
2. optionally (--live) re-reads the *current* OSM tags of exactly the same
   way/relation ids from Overpass and counts roof tags there.

Read-only: it writes nothing unless --json-out is given.

    python scripts/count_roof_tags.py
    python scripts/count_roof_tags.py --live --json-out artifacts/b9.5-lod2/roof_tags.json
    # if Python TLS fails behind a proxy:
    python scripts/count_roof_tags.py --print-query > q.txt
    curl -A IE402 --data-urlencode data@q.txt https://overpass-api.de/api/interpreter > osm.json
    python scripts/count_roof_tags.py --overpass-json osm.json
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOF_KEYS = (
    "roof:shape",
    "roof:height",
    "roof:levels",
    "roof:direction",
    "roof:orientation",
    "roof:angle",
    "roof:colour",
    "roof:material",
    "building:roof:shape",
)
HEIGHT_KEYS = (
    "height",
    "min_height",
    "building:levels",
    "building:min_level",
    "building:part",
)
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)


def present(value: object) -> bool:
    return value not in (None, "", "nan")


def count_local(path: Path) -> dict:
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    keys = collections.Counter(k for f in features for k in (f["properties"] or {}))
    nonnull = {
        k: sum(1 for f in features if present((f["properties"] or {}).get(k)))
        for k in sorted(keys)
    }
    return {
        "file": str(path),
        "buildings": len(features),
        "columns": sorted(keys),
        "non_null": nonnull,
        "roof_keys_present": [k for k in ROOF_KEYS if k in keys],
        "building_values": dict(
            collections.Counter(str(f["properties"].get("building")) for f in features)
        ),
        "ids": [(f["properties"]["osm_type"], str(f["properties"]["osm_id"])) for f in features],
    }


def overpass(query: str, timeout: float = 90.0) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for url in OVERPASS_ENDPOINTS:
        try:
            req = urllib.request.Request(
                url, data=data, headers={"User-Agent": "IE402-B9.5-roof-audit"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - try next mirror
            last = exc
    raise RuntimeError(f"all Overpass endpoints failed: {last}")


def build_query(ids: list[tuple[str, str]], bbox: tuple[float, float, float, float]) -> str:
    ways = ",".join(i for t, i in ids if t == "way")
    rels = ",".join(i for t, i in ids if t == "relation")
    parts = []
    if ways:
        parts.append(f"way(id:{ways});")
    if rels:
        parts.append(f"relation(id:{rels});")
    s, w, n, e = bbox
    query = (
        "[out:json][timeout:60];("
        + "".join(parts)
        + f'way["building:part"]({s},{w},{n},{e});'
        + f'relation["building:part"]({s},{w},{n},{e});'
        + ");out tags;"
    )
    return query


def count_live(ids: list[tuple[str, str]], elements: list[dict]) -> dict:
    wanted = {(t, i) for t, i in ids}
    main = [el for el in elements if (el["type"], str(el["id"])) in wanted]
    parts_found = [el for el in elements if (el["type"], str(el["id"])) not in wanted]

    def tally(els: list[dict]) -> dict:
        out = {}
        for key in ROOF_KEYS + HEIGHT_KEYS:
            vals = [el.get("tags", {}).get(key) for el in els]
            vals = [v for v in vals if present(v)]
            out[key] = {"count": len(vals), "values": dict(collections.Counter(vals))}
        any_roof = sum(
            1 for el in els if any(present(el.get("tags", {}).get(k)) for k in ROOF_KEYS)
        )
        shape_non_flat = sum(
            1
            for el in els
            if present(el.get("tags", {}).get("roof:shape"))
            and el["tags"]["roof:shape"] != "flat"
        )
        return {
            "elements": len(els),
            "with_any_roof_tag": any_roof,
            "roof_shape_non_flat": shape_non_flat,
            "keys": out,
            "building_values": dict(
                collections.Counter(el.get("tags", {}).get("building") for el in els)
            ),
        }

    return {
        "requested_ids": len(ids),
        "returned_ids": len(main),
        "missing_ids": sorted(
            f"{t}/{i}" for t, i in wanted - {(el["type"], str(el["id"])) for el in main}
        ),
        "buildings": tally(main),
        "building_parts_in_bbox": tally(parts_found),
        "roof_tagged_examples": [
            {"id": f'{el["type"]}/{el["id"]}', **{k: v for k, v in el.get("tags", {}).items() if k.startswith("roof") or k in HEIGHT_KEYS or k in ("building", "name")}}
            for el in main + parts_found
            if any(present(el.get("tags", {}).get(k)) for k in ROOF_KEYS)
        ],
    }


def study_bbox(path: Path) -> tuple[float, float, float, float]:
    ring = json.loads(path.read_text(encoding="utf-8"))["features"][0]["geometry"]["coordinates"][0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lats), min(lons), max(lats), max(lons)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--buildings", type=Path, default=root / "data/raw/buildings.geojson")
    ap.add_argument("--study-area", type=Path, default=root / "data/raw/study_area.geojson")
    ap.add_argument("--live", action="store_true", help="query current OSM tags via Overpass")
    ap.add_argument(
        "--overpass-json",
        type=Path,
        default=None,
        help="use a saved Overpass response instead of querying (e.g. fetched with curl "
        "when Python's TLS store rejects a proxy certificate)",
    )
    ap.add_argument("--print-query", action="store_true", help="print the Overpass QL and exit")
    ap.add_argument("--json-out", type=Path, default=None)
    args = ap.parse_args()

    local = count_local(args.buildings)
    query = build_query(local["ids"], study_bbox(args.study_area))
    if args.print_query:
        print(query)
        return 0
    report: dict = {"local": {k: v for k, v in local.items() if k != "ids"}}
    print(f"Local file: {local['file']}  buildings={local['buildings']}")
    print(f"  columns: {', '.join(local['columns'])}")
    print(f"  non-null: {local['non_null']}")
    print(f"  roof keys present locally: {local['roof_keys_present'] or 'none'}")

    if args.live or args.overpass_json:
        if args.overpass_json:
            elements = json.loads(args.overpass_json.read_text(encoding="utf-8"))["elements"]
        else:
            elements = overpass(query)["elements"]
        live = count_live(local["ids"], elements)
        report["live_osm"] = live
        b = live["buildings"]
        print(f"Live OSM: requested={live['requested_ids']} returned={live['returned_ids']} missing={live['missing_ids']}")
        print(f"  buildings with any roof tag: {b['with_any_roof_tag']}/{b['elements']}")
        print(f"  roof:shape non-flat: {b['roof_shape_non_flat']}")
        for key, info in b["keys"].items():
            print(f"  {key:22s} {info['count']:3d}  {info['values'] if info['count'] else ''}")
        p = live["building_parts_in_bbox"]
        print(f"  building:part in bbox: {p['elements']} (with roof tag: {p['with_any_roof_tag']})")
        for ex in live["roof_tagged_examples"]:
            print(f"    {ex}")

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
