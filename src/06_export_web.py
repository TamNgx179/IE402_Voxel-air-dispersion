"""
Export every configured scenario to web/data/ for the 3D viewer.

    python src/06_export_web.py --config config/project.yaml

Reads concentration files on the data contract (src/analysis/fields.py);
run src/04_analysis.py --baselines first if none exist yet. Refuses to write
past `web.size_budget_bytes`. Format: src/analysis/web_export.py.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from analysis.web_export import export_web  # noqa: E402
from project_config import load_project_config  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="netCDF -> web/data for the 3D viewer")
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    summary = export_web(load_project_config(args.config))

    for name, size in sorted(summary["bytes"].items()):
        print(f"  {name:<40} {size / 1e3:9.1f} kB")

    print(
        f"web/data total {summary['total_bytes'] / 1e6:.2f} MB "
        f"of a {summary['budget_bytes'] / 1e6:.0f} MB budget -> {summary['output_dir']}"
    )


if __name__ == "__main__":
    main()
