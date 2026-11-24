"""Controlled roof-height alternatives, preserving footprints and emissions.

Run with --heights pointing to an explicit JSON mapping of scene feature IDs
to alternative metre values. Tags are a sensitivity assumption, not ground truth.
"""
import argparse
import copy
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from src.production_study import execute, extend_top, raster_height
from src.solver import REPO_ROOT, sha256


def prepare_variant(config, out, heights, *, top_m):
    """Prepare both baseline and alternative with exactly the same roof rule."""
    scene = REPO_ROOT / config['paths']['scene_package_dir']
    original = json.loads((scene / 'scene_manifest.json').read_text(encoding='utf-8'))
    grid = original['grid']
    layers = top_m / grid['dz_m'] - grid['nz']
    if not math.isfinite(layers) or layers < 1 or not layers.is_integer():
        raise ValueError('top_m must add whole air layers above the original top')
    buildings = pd.read_csv(scene / 'buildings.csv')
    for feature_id, height in heights.items():
        if isinstance(height, bool) or not isinstance(height, (float, int)) or not math.isfinite(height) or not 0 < height < top_m:
            raise ValueError('Alternative height must be positive, finite and below top_m')
        match = buildings.source_feature_id == feature_id
        if match.sum() != 1:
            raise ValueError(f'Expected one footprint for {feature_id}')
        buildings.loc[match, 'height_m'] = height
        buildings.loc[match, 'height_source'] = 'sensitivity:explicit_height'
    if buildings.height_m.max() >= top_m:
        raise ValueError('All roofs must be below top_m')

    extend_top(config, out, extra_layers=int(layers))
    target = out / 'scene'
    manifest = json.loads((target / 'scene_manifest.json').read_text(encoding='utf-8'))
    buildings.to_csv(target / 'buildings.csv', index=False)
    g = manifest['grid']
    roof = raster_height(target, g, config['voxelization']['rasterization']['all_touched'])
    z = (np.arange(g['nz']) + .5) * g['dz_m']
    counts = (z[:, None, None] < roof).sum(axis=0)
    cells = pd.read_csv(target / 'grid_cells.csv')
    occupied = counts[cells.j.to_numpy(), cells.i.to_numpy()]
    cells['solid_from_k'] = pd.array(np.where(occupied > 0, 0, np.nan), dtype='Int64')
    cells['solid_to_k'] = pd.array(np.where(occupied > 0, occupied - 1, np.nan), dtype='Int64')
    cells.to_csv(target / 'grid_cells.csv', index=False)
    manifest['files'] = {name: sha256(target / name) for name in manifest['files']}
    manifest['sensitivity'] = {'top_m': top_m, 'alternative_heights_m': heights,
                               'rasterized_both_cases': True, 'ground_truth': False}
    (target / 'scene_manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('config/project.yaml'))
    parser.add_argument('--heights', type=Path, required=True)
    parser.add_argument('--top-m', type=float, default=250)
    parser.add_argument('--out', type=Path, default=Path('artifacts/building-height-study'))
    args = parser.parse_args()
    root = (REPO_ROOT / args.out).resolve()
    # execute() reports repository-relative paths. Reject incompatible output
    # locations before an expensive solver run, not after it has finished.
    if not root.is_relative_to(REPO_ROOT.resolve()):
        parser.error('--out must be inside the project directory')
    heights = json.loads(args.heights.read_text(encoding='utf-8'))
    if not isinstance(heights, dict) or not heights:
        parser.error('--heights must contain a nonempty feature-to-height mapping')
    base = yaml.safe_load(args.config.read_text(encoding='utf-8'))
    report = {'assumption': 'explicit height alternative, not ground truth', 'runs': []}
    for name, variant in [('baseline', {}), ('height_alternative', heights)]:
        prep = root / (name + '-input')
        prep.mkdir(parents=True, exist_ok=False)
        config = copy.deepcopy(base)
        prepare_variant(config, prep, variant, top_m=args.top_m)
        result = execute(config, name, root)
        report['runs'].append(result)
        (root / 'study.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        if result['exit_code']:
            raise SystemExit('Height study failed production quality gates')


if __name__ == '__main__':
    main()
