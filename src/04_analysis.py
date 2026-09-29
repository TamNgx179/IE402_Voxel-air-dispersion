"""
Tier 3 - spatial analysis of every scenario on the data contract.

    python src/04_analysis.py --config config/project.yaml --baselines

`--baselines` (re)builds the Gaussian road-source scenarios first. Then every
scenario in `web.scenarios` whose concentration file exists is analysed and
written to `output/analysis/analysis_<scenario>.json`. Operators live in
src/analysis/operators.py; the contract in src/analysis/fields.py.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from analysis.pipeline import (  # noqa: E402
    analyse,
    concentration_path,
    load_scenario,
    report_path,
    run_gaussian_baselines,
    street_canyons,
    write_report,
)
from project_config import get_required, load_project_config  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Tier 3 spatial analysis")
    parser.add_argument("--config", required=True)
    parser.add_argument("--baselines", action="store_true", help="rebuild the Gaussian road-source scenarios first")
    args = parser.parse_args()

    config = load_project_config(args.config)

    if args.baselines:
        for path in run_gaussian_baselines(config):
            print(f"Baseline written: {path}")

    canyons, canyon_path = street_canyons(config)
    ratio = canyons["aspect_ratio"]
    print(
        f"Street canyons (G5): {canyons['two_sided']}/{canyons['samples']} samples two-sided; "
        f"H/W median {ratio.get('median', float('nan')):.2f} (IQR {ratio.get('p25', float('nan')):.2f}–"
        f"{ratio.get('p75', float('nan')):.2f}) -> {canyon_path}"
    )

    analysed = 0

    for scenario in get_required(config, "web.scenarios"):
        if not concentration_path(config, scenario).exists():
            print(f"SKIP {scenario}: {concentration_path(config, scenario)} not found")
            continue

        report = analyse(load_scenario(config, scenario), config)
        path = write_report(report, report_path(config, scenario))
        analysed += 1

        volumes = ", ".join(f"{key} {value:,.0f} m³" for key, value in report["exceedance_volume_m3"].items())
        print(
            f"{scenario}: max {report['maximum']['c_ug_m3']:.3g} µg/m³ at z={report['maximum']['z_m']:g} m; "
            f"domain mean {report['domain_mean_ug_m3']:.3g}; exceedance {volumes} -> {path}"
        )

    if analysed == 0:
        raise SystemExit("no scenario analysed: no concentration file matched web.scenarios")


if __name__ == "__main__":
    main()
