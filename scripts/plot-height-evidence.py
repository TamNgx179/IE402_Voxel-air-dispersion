"""Plot paired Nguyen Hue air cells and the checked PostGIS transect."""
import argparse
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Directory with verify-height-evidence outputs")
    directory = parser.parse_args().directory
    evidence = json.loads((directory / "height-evidence.json").read_text(encoding="utf-8"))
    section = json.loads((directory / "height-section.json").read_text(encoding="utf-8"))
    with (directory / "height-pairs.csv").open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    if len(rows) != evidence["paired_columns"] or section["run_id"] != evidence["run_id"]:
        raise ValueError("Data and run provenance do not match the height summary")

    i = np.array([int(row["i"]) for row in rows])
    j = np.array([int(row["j"]) for row in rows])
    low = np.array([float(row["c_1m_ug_m3"]) for row in rows])
    high = np.array([float(row["c_15m_ug_m3"]) for row in rows])
    distances = np.array([sample["distance_m"] for sample in section["samples"]])
    edges = np.r_[0, (distances[1:] + distances[:-1]) / 2, distances[-1]]
    layers = section["layers"]
    heights = [layers[0]["overlap_min_m"], *(layer["overlap_max_m"] for layer in layers)]
    values = np.array([[cell["concentration_ug_m3"] if cell["status"] == "air" else np.nan
                        for cell in sample["cells"]] for sample in section["samples"]]).T
    solid = np.array([[cell["status"] == "solid" for cell in sample["cells"]]
                      for sample in section["samples"]]).T

    fig = plt.figure(figsize=(10, 9), layout="constrained")
    grid = fig.add_gridspec(2, 2, height_ratios=[1, .55])
    maps = [fig.add_subplot(grid[0, col]) for col in (0, 1)]
    limit = max(float(low.max()), float(high.max()), float(np.nanmax(values)))
    for ax, data, height in zip(maps, (low, high), (1, 15), strict=True):
        cells = np.full((j.max() + 1, i.max() + 1), np.nan)
        cells[j, i] = data
        plot = ax.imshow(cells, origin="lower", cmap="magma", vmin=0, vmax=limit,
                         interpolation="none")
        ax.set(title=f"{height} m above ground", xlabel="Column index i (east)", ylabel="Row index j (north)")
        ax.legend(handles=[Patch(facecolor="white", edgecolor="#94a3b8", label="No air data at both heights")],
                  loc="lower left", fontsize=8)
        for marker, cell in zip(("A", "B"), (evidence["examples"][0], evidence["examples"][-1]), strict=True):
            offset = (5, -15) if cell["j"] >= j.max() - 3 else (5, 4)
            ax.annotate(marker, (cell["i"], cell["j"]), xytext=offset, textcoords="offset points",
                        color="white", bbox={"boxstyle": "round", "fc": "#25384a", "ec": "none"})
        ax.plot([evidence["examples"][0]["i"], evidence["examples"][-1]["i"]],
                [evidence["examples"][0]["j"], evidence["examples"][-1]["j"]],
                color="#72e3df", linewidth=1)
    ax = fig.add_subplot(grid[1, :])
    ax.set_facecolor("#f3f5f7")
    ax.pcolormesh(edges, heights, values, cmap="magma", vmin=0, vmax=limit)
    ax.pcolormesh(edges, heights, np.ma.masked_where(~solid, solid), cmap=matplotlib.colors.ListedColormap(["#64748b"]))
    ax.set(title="Vertical section from A to B", xlabel="Distance from A (m)", ylabel="Height (m)")
    ax.legend(handles=[Patch(color="#64748b", label="Building"), Patch(color="#f3f5f7", label="No data")])
    fig.colorbar(plot, ax=[*maps, ax], label="Modelled PM₂.₅ contribution (µg/m³)")
    fig.suptitle(f"Nguyen Hue, dry season | {len(rows):,} paired air columns\nRun {section['run_id']}")
    fig.savefig(directory / "height-evidence.png", dpi=160)


if __name__ == "__main__":
    main()
