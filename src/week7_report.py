"""B7.4/B7.6: derive report tables and captions from verified run artifacts.

Nothing is copied from old documentation. The manifest and every referenced
artifact are checked before a value is accepted into the candidate report.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = ('dry', 'wet', 'k_half', 'height_low', 'height_high')
FIGURES = {
    'geometry-overlay.png': {
        'title': 'LoD1 geometry and ground-level occupancy',
        'caption': 'Checksum-locked GIS footprints over ground voxel occupancy. Axes are UTM metres. Flat terrain and voxel roof quantisation apply.',
        'claims': ['QG-6', 'B7.5'],
    },
    'convergence.png': {
        'title': 'Steady-state convergence of the two baseline seasons',
        'caption': 'Relative L1 concentration change over 30 simulated seconds. The acceptance tolerance is 0.001; three consecutive checks are required after 600 simulated seconds.',
        'claims': ['QG-4', 'B7.1'],
    },
    'vertical-comparison.png': {
        'title': 'Vertical concentration profile for the two baseline seasons',
        'caption': 'Air-cell mean and maximum PM2.5 in micrograms per cubic metre at voxel-centre heights. Buildings are excluded rather than assigned zero concentration.',
        'claims': ['QG-10', 'B6.3'],
    },
    'height-slices.png': {
        'title': 'PM2.5 slices at 1 m and 15 m',
        'caption': 'Two baseline seasons with a shared logarithmic colour scale. The request height 1.5 m selects the voxel centred at 1 m; the 15 m request selects the voxel centred at 15 m.',
        'claims': ['QG-10', 'B7.4'],
    },
}


def sha(path: Path) -> str:
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def verify_run(folder: Path, expected_id: str) -> dict:
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf8'))
    require(manifest['run_id'] == expected_id, 'Manifest identity differs from analysis')
    require(manifest['verification']['status'] == 'pass', 'Report refuses failed verification')
    require(manifest['verification']['checks'], 'Empty verification checks')
    require(all(item['status'] == 'pass' for item in manifest['verification']['checks'].values()), 'One gate failed')
    require(manifest['stopping']['criterion'] == 'steady_state', 'Report requires steady-state output')
    require(manifest['model'] == 'fv', 'FV is the primary report result')
    require(not any('mock run' in text.lower() for text in manifest['warnings']), 'Mock output cannot be a production result')
    for item in manifest['artifacts']:
        path = (folder / item['path']).resolve()
        require(path.is_relative_to(folder.resolve()), 'Artifact path escapes run directory')
        require(path.stat().st_size == item['size_bytes'], f'Artifact size differs: {item["kind"]}')
        require(sha(path) == item['sha256'], f'Artifact checksum differs: {item["kind"]}')
    return manifest


def report(study_root: Path) -> dict:
    analysis_path = study_root / 'analysis.json'
    analysis = json.loads(analysis_path.read_text(encoding='utf8'))
    runs = analysis['runs']
    require(len(runs) == 5 and {run['case'] for run in runs} == set(CASES), 'Need exactly five production cases')
    freeze = json.loads((ROOT / 'deploy/model-freeze.json').read_text(encoding='utf8'))
    for name, expected in analysis['model_source_sha256'].items():
        require(sha(ROOT / name) == expected == freeze['files'][name], f'Model source changed after analysis: {name}')
    versions = set()
    tables = []
    identities = []
    gates = []
    for run in sorted(runs, key=lambda item: CASES.index(item['case'])):
        folder = study_root / run['case'] / run['run_id']
        manifest = verify_run(folder, run['run_id'])
        require(sha(folder / 'manifest.json') == run['manifest_sha256'], 'Analysis manifest digest differs')
        versions.add(manifest['model_version'])
        identities.append({
            'case': run['case'], 'run_id': run['run_id'], 'input_hash': run['input_hash'],
            'model_version': manifest['model_version'], 'manifest_sha256': run['manifest_sha256'],
            'verification': 'pass',
        })
        measurement = run['runtime_measurement'] or {}
        for layer in run['summary']['layers']:
            tables.append({
                'case': run['case'], 'run_id': run['run_id'],
                'requested_z_m': layer['requested_z_m'], 'z_center_m': layer['z_center_m'],
                'mean_ug_m3': layer['mean_ug_m3'], 'max_ug_m3': layer['max_ug_m3'],
                'solver_wall_s': run['metrics']['wall_clock_s'],
                'process_wall_s': measurement.get('wall_clock_s'),
                'peak_rss_mb': measurement.get('peak_rss_mb'),
                'steady_residual': run['stopping']['residual'],
            })
        for name, check in manifest['verification']['checks'].items():
            gates.append({'case': run['case'], 'run_id': run['run_id'], 'check': name, **check})
    require(len(versions) == 1, 'Final candidate cases must use the same model version')
    figure_index = []
    for filename, caption in FIGURES.items():
        path = study_root / filename
        require(path.is_file(), f'Missing report figure: {filename}')
        figure_index.append({'file': filename, 'sha256': sha(path), 'dpi': 300, **caption})
    result = {
        'schema_version': 1, 'milestones': ['B7.4', 'B7.6'], 'status': 'candidate_pass',
        'analysis_sha256': sha(analysis_path),
        'model_version': next(iter(versions)),
        'model_source_sha256': analysis['model_source_sha256'],
        'runs': identities, 'layers': tables, 'verification': gates,
        'sensitivity': analysis['sensitivity'], 'geometry': analysis['geometry_audit'],
        'analytic_cross_check': analysis['analytic_cross_check'],
        'figures': figure_index, 'limitations': analysis['limitations'],
        'claim_scope': 'Numerical verification and sensitivity on a real GIS/EDGAR proxy; not field validation or proof of safe ambient air.',
    }
    (study_root / 'report-assets.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
    for filename, rows in [('layer-results.csv', tables), ('verification-results.csv', gates),
                           ('sensitivity-results.csv', analysis['sensitivity'])]:
        with (study_root / filename).open('w', encoding='utf8', newline='') as handle:
            # Checks have optional detail fields; retain their union.
            fields = list(dict.fromkeys(key for row in rows for key in row))
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
    lines = [
        '# Candidate report assets', '', f'Model version: `{result["model_version"]}`', '',
        '| Case | Centre height (m) | Mean (ug/m3) | Max (ug/m3) | Solver wall (s) | Run ID |',
        '|---|---:|---:|---:|---:|---|',
    ]
    for row in tables:
        lines.append(f'| {row["case"]} | {row["z_center_m"]:g} | {row["mean_ug_m3"]:.6f} | {row["max_ug_m3"]:.6f} | {row["solver_wall_s"]:.2f} | `{row["run_id"]}` |')
    lines.extend(['', '## Sensitivity', '', '| Case | Mean change (%) | Maximum change (%) |', '|---|---:|---:|'])
    for row in analysis['sensitivity']:
        lines.append(f'| {row["case"]} | {row["mean_change_pct"]:+.3f} | {row["max_change_pct"]:+.3f} |')
    lines.extend(['', '## Figure captions', ''])
    for item in figure_index:
        lines.extend([f'### {item["title"]}', '', f'File: `{item["file"]}` — 300 dpi', '', item['caption'], ''])
    lines.extend(['## Claim boundaries', '', result['claim_scope'], ''])
    lines.extend(f'- {limitation}' for limitation in result['limitations'])
    (study_root / 'report-assets.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT / 'artifacts/week7/production')
    args = parser.parse_args()
    try:
        result = report(args.root.resolve())
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f'Candidate report refused: {error}\n')
    print(json.dumps({'status': result['status'], 'runs': len(result['runs']), 'figures': len(result['figures'])}))


if __name__ == '__main__':
    main()
