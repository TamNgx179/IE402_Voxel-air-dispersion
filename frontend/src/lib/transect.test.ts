import { describe, expect, it } from 'vitest';
import { AppError } from '../api/client';
import { translate, type TranslationKey, type TranslationParams } from '../i18n';
import {
  TRANSECT_MAX_POINTS,
  addTransectPoint,
  axisTicks,
  canFinishTransect,
  cellFill,
  hasAir,
  layerSpan,
  maxStep,
  moveSelection,
  pickCell,
  plotBox,
  readingText,
  sampleSpan,
  selectedReading,
  transectCsvFilename,
  transectLine,
  transectMax,
  transectRequest,
  transectSampleCount,
  validStep,
  xScale,
  yScale,
  type LngLat,
  type TransectResult,
} from './transect';

const result: TransectResult = {
  run_id: 'base',
  length_m: 10,
  z_min_m: 0,
  z_max_m: 3,
  units: 'ug m-3',
  layers: [
    { k: 0, z_center_m: 1, overlap_min_m: 0, overlap_max_m: 2 },
    { k: 1, z_center_m: 3, overlap_min_m: 2, overlap_max_m: 3 },
  ],
  samples: [
    {
      distance_m: 0,
      i: 0,
      j: 1,
      cells: [
        { k: 0, status: 'air', concentration_ug_m3: 0 },
        { k: 1, status: 'no_data', concentration_ug_m3: null },
      ],
    },
    {
      distance_m: 10,
      i: 1,
      j: 1,
      cells: [
        { k: 0, status: 'solid', concentration_ug_m3: null },
        { k: 1, status: 'air', concentration_ug_m3: 11 },
      ],
    },
  ],
};

const vi = (key: TranslationKey, params?: TranslationParams) => translate('vi', key, params);
const fmt = (v: number) => v.toLocaleString('vi-VN', { maximumSignificantDigits: 5 });
const read = (position: number, layer: number) => readingText(selectedReading(result, position, layer), vi, fmt);

const keyOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).messageKey;
  }
  throw new Error('expected a throw');
};

describe('drawing', () => {
  it('ignores repeated points, only allows finishing at two points and caps at 100', () => {
    let points: LngLat[] = [];
    expect(canFinishTransect(points)).toBe(false);
    points = addTransectPoint(points, [106.7, 10.77]).points;
    const dup = addTransectPoint(points, [106.7, 10.77]);
    expect(dup.status).toBe('duplicate');
    expect(canFinishTransect(dup.points)).toBe(false);
    expect(transectLine(dup.points)).toBeNull();
    const next = addTransectPoint(points, [106.71, 10.78]);
    expect(next.status).toBe('added');
    expect(points).toHaveLength(1);
    expect(canFinishTransect(next.points)).toBe(true);
    expect(transectLine(next.points)).toEqual({
      type: 'LineString',
      coordinates: [
        [106.7, 10.77],
        [106.71, 10.78],
      ],
    });
    const full = Array.from({ length: TRANSECT_MAX_POINTS }, (_, n): LngLat => [106 + n / 1000, 10]);
    expect(addTransectPoint(full, [107, 11]).status).toBe('full');
    expect(addTransectPoint(full.slice(1), [107, 11]).status).toBe('added');
    expect(vi('analysis.transect.maxPoints', { max: TRANSECT_MAX_POINTS })).toBe('Tối đa 100 điểm trên một tuyến.');
  });
});

describe('transectRequest', () => {
  const line = transectLine([
    [106.7, 10.77],
    [106.71, 10.78],
  ]);
  const ok = { line, runId: 'base', modified: false, min: '0', max: '3', height: 100 };
  it('builds the request body', () => {
    expect(transectRequest(ok)).toEqual({ line, z_min_m: 0, z_max_m: 3 });
  });
  it('never queries without a line/run, with illustration on, or with invalid heights', () => {
    expect(keyOf(() => transectRequest({ ...ok, line: null }))).toBe('analysis.transect.noLine');
    expect(keyOf(() => transectRequest({ ...ok, runId: '' }))).toBe('analysis.transect.noRun');
    expect(keyOf(() => transectRequest({ ...ok, modified: true }))).toBe('analysis.transect.modified');
    for (const max of ['-1', '0', '101', ''])
      expect(keyOf(() => transectRequest({ ...ok, max }))).toBe('analysis.transect.heightRange');
  });
});

describe('sampling rules', () => {
  const grid = { dx_m: 2, dy_m: 2.5 };
  it('limits the step to the finer horizontal cell size', () => {
    expect(maxStep(grid)).toBe(2);
    expect(validStep(2, grid)).toBe(true);
    expect(validStep(0.5, grid)).toBe(true);
    for (const step of [0, -1, 2.01, NaN]) expect(validStep(step, grid)).toBe(false);
  });
  it('counts partially overlapped layers and returned cells like the server', () => {
    expect(layerSpan(0, 3, 2)).toEqual({ first: 0, last: 1, count: 2 });
    expect(layerSpan(1, 4, 2)).toEqual({ first: 0, last: 1, count: 2 });
    expect(layerSpan(2, 4.1, 2)).toEqual({ first: 1, last: 2, count: 2 });
    expect(transectSampleCount(10, 2, 0, 3, 2)).toBe(12);
    expect(transectSampleCount(10.5, 2, 0, 3, 2)).toBe(14);
  });
});

describe('reading cells', () => {
  it('reads exact cells keeping zero, buildings and missing data distinct', () => {
    expect(selectedReading(result, 1, 1)).toEqual({
      distanceM: 10,
      zCenterM: 3,
      i: 1,
      j: 1,
      k: 1,
      status: 'air',
      concentration: 11,
    });
    expect(read(0, 0)).toBe('0 m từ đầu tuyến · tâm tầng 1 m · ô (0, 1, 0): 0 µg/m³');
    expect(read(0, 1)).toMatch(/Không có dữ liệu/);
    expect(read(1, 1)).toMatch(/11 µg\/m³/);
    expect(read(1, 0)).toMatch(/Tòa nhà/);
    expect(readingText(selectedReading(result, 1, 0), (k, p) => translate('en', k, p), String)).toBe(
      '10 m from the line start · layer centre 1 m · cell (1, 1, 0): Building',
    );
  });
  it('detects results without air and the linear colour maximum', () => {
    expect(hasAir(result)).toBe(true);
    expect(transectMax(result)).toBe(11);
    const empty: TransectResult = {
      ...result,
      samples: result.samples.map((s) => ({
        ...s,
        cells: s.cells.map((c) => ({ ...c, status: 'no_data' as const, concentration_ug_m3: null })),
      })),
    };
    expect(hasAir(empty)).toBe(false);
    expect(transectMax(empty)).toBe(0);
    expect(vi('analysis.transect.readingNoData')).toBe('Không có dữ liệu');
  });
  it('fills solid, missing and air cells distinctly', () => {
    expect(cellFill(result.samples[1].cells[0], 11)).toBe('#929fa9');
    expect(cellFill(result.samples[0].cells[1], 11)).toBe('#ffffff');
    expect(cellFill(result.samples[0].cells[0], 11)).toBe('rgb(248,238,211)');
    expect(cellFill(result.samples[1].cells[1], 11)).toBe('rgb(112,53,65)');
  });
});

describe('chart geometry', () => {
  const box = plotBox(600);
  it('uses the legacy frame', () => {
    expect(box).toEqual({ width: 600, height: 250, left: 52, right: 584, top: 18, bottom: 212 });
    expect(plotBox(100).width).toBe(280);
  });
  it('maps distance and altitude to pixels', () => {
    expect(xScale(result, box)(0)).toBe(52);
    expect(xScale(result, box)(10)).toBe(584);
    expect(yScale(result, box)(0)).toBe(212);
    expect(yScale(result, box)(3)).toBe(18);
  });
  it('spans each sample to the midpoints with its neighbours', () => {
    expect(sampleSpan(result, 0)).toEqual([0, 5]);
    expect(sampleSpan(result, 1)).toEqual([5, 10]);
    expect(axisTicks(result)).toEqual({ z: [0, 0.75, 1.5, 2.25, 3], d: [0, 2.5, 5, 7.5, 10] });
  });
  it('picks the nearest sample and the half-open layer under the pointer', () => {
    expect(pickCell(result, box, 60, 200)).toEqual({ position: 0, layer: 0 });
    expect(pickCell(result, box, 580, 20)).toEqual({ position: 1, layer: 1 });
    expect(pickCell(result, box, 10, 100)).toBeNull();
    expect(pickCell(result, box, 60, 230)).toBeNull();
  });
  it('an internal height face selects the upper layer; the top border reads the last visible layer', () => {
    const boundary: TransectResult = {
      ...result,
      z_max_m: 4,
      layers: [result.layers[0], { ...result.layers[1], overlap_max_m: 4 }],
    };
    // Plot y=[18,212], z=[4,0]: y=115 is exactly the z=2 internal face.
    for (const y of [115, 18]) {
      const picked = pickCell(boundary, box, 60, y);
      expect(picked).toEqual({ position: 0, layer: 1 });
      expect(readingText(selectedReading(boundary, picked!.position, picked!.layer), vi, fmt)).toMatch(
        /Không có dữ liệu/,
      );
    }
  });
  it('moves the selection with arrow/Home/End keys and clamps at edges', () => {
    let sel = { position: 0, layer: 0 };
    sel = moveSelection(result, sel, 'ArrowUp')!;
    expect(read(sel.position, sel.layer)).toMatch(/Không có dữ liệu/);
    sel = moveSelection(result, sel, 'ArrowRight')!;
    expect(read(sel.position, sel.layer)).toMatch(/11 µg\/m³/);
    sel = moveSelection(result, sel, 'ArrowDown')!;
    expect(read(sel.position, sel.layer)).toMatch(/Tòa nhà/);
    expect(moveSelection(result, sel, 'ArrowDown')).toEqual({ position: 1, layer: 0 });
    expect(moveSelection(result, sel, 'ArrowRight')).toEqual({ position: 1, layer: 0 });
    expect(moveSelection(result, sel, 'Home')).toEqual({ position: 0, layer: 0 });
    expect(moveSelection(result, { position: 0, layer: 1 }, 'End')).toEqual({ position: 1, layer: 1 });
    expect(moveSelection(result, { position: 0, layer: 1 }, 'ArrowUp')).toEqual({ position: 0, layer: 1 });
    expect(moveSelection(result, sel, 'Enter')).toBeNull();
  });
  it('names the CSV after the run', () => {
    expect(transectCsvFilename('base')).toBe('transect-base.csv');
  });
});
