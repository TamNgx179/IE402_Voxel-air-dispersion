import { describe, expect, it } from 'vitest';
import { ApiError, AppError } from '../api/client';
import { translate } from '../i18n';
import { analysisErrorKey, closePolygon, color, latestTask, polygonShape, regionRequest } from './analysis';

const keyOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).messageKey;
  }
  throw new Error('expected a throw');
};

describe('color', () => {
  it('keeps signed delta colours symmetric around a neutral zero and never hides zero', () => {
    expect(color(0, -5, 5, true)).toEqual([245, 242, 232, 205]);
    expect(color(-5, -5, 5, true)).toEqual([75, 111, 140, 205]);
    expect(color(5, -5, 5, true)).toEqual([157, 83, 78, 205]);
    expect(color(NaN, 0, 1)[3]).toBe(0);
    expect(color(null, 0, 1)[3]).toBe(0);
    expect(color(0, 0, 0)[3]).toBe(205);
    expect(color(2, 0, 10)).toEqual(color(2, 0, 10));
  });
  it('uses the linear ramp end points and clamps', () => {
    expect(color(0, 0, 10)).toEqual([248, 238, 211, 205]);
    expect(color(10, 0, 10)).toEqual([112, 53, 65, 205]);
    expect(color(20, 0, 10)).toEqual([112, 53, 65, 205]);
    expect(color(-1, 0, 10)).toEqual([248, 238, 211, 205]);
  });
});

describe('closePolygon / polygonShape', () => {
  it('closes a pointer polygon without mutating points and rejects undersized/invalid input', () => {
    const points = [
      [106, 10],
      [107, 10],
      [107, 11],
    ];
    const polygon = closePolygon(points);
    expect(polygon.coordinates[0]).toHaveLength(4);
    expect(points).toHaveLength(3);
    expect(polygon.coordinates[0][0]).toEqual(polygon.coordinates[0].at(-1));
    expect(keyOf(() => closePolygon(points.slice(0, 2)))).toBe('analysis.polygon.minVertices');
    expect(
      keyOf(() =>
        closePolygon([
          [NaN, 0],
          [0, 1],
          [1, 0],
        ]),
      ),
    ).toBe('analysis.polygon.invalidVertices');
    expect(keyOf(() => closePolygon(Array.from({ length: 500 }, (_, i) => [106 + i / 1000, 10])))).toBe(
      'analysis.polygon.invalidVertices',
    );
  });
  it('does not double-close an already closed ring', () => {
    const ring = [
      [106, 10],
      [107, 10],
      [107, 11],
      [106, 10],
    ];
    expect(closePolygon(ring).coordinates[0]).toHaveLength(4);
  });
  it('rejects malformed keyboard GeoJSON before it can crash a map layer', () => {
    const ring = [
      [106, 10],
      [106, 11],
      [107, 11],
      [106, 10],
    ];
    const cases: Array<[unknown, string]> = [
      [[], 'analysis.polygon.shape'],
      [[null], 'analysis.polygon.ringSize'],
      [['abc'], 'analysis.polygon.ringSize'],
      [[ring.slice(0, 3)], 'analysis.polygon.ringSize'],
      [
        [
          [
            [190, 10],
            [190, 11],
            [191, 11],
            [190, 10],
          ],
        ],
        'analysis.polygon.coordinates',
      ],
      [Array(21).fill(ring), 'analysis.polygon.shape'],
      [[Array(501).fill([106, 10])], 'analysis.polygon.maxCoordinates'],
      [[[...ring.slice(0, 3), [107, 12]]], 'analysis.polygon.ringClosed'],
      [[[[106, 10, 5], ...ring.slice(1)]], 'analysis.polygon.coordinates'],
    ];
    for (const [coordinates, key] of cases) expect(keyOf(() => polygonShape({ type: 'Polygon', coordinates }))).toBe(key);
    expect(keyOf(() => polygonShape({ type: 'Polygon', coordinates: [ring], extra: 1 }))).toBe('analysis.polygon.shape');
    expect(keyOf(() => polygonShape(null))).toBe('analysis.polygon.shape');
    const copy = polygonShape({ type: 'Polygon', coordinates: [ring] });
    expect(copy.coordinates[0]).toEqual(ring);
    expect(copy.coordinates[0]).not.toBe(ring);
  });
});

describe('latestTask', () => {
  it('drops late success and late errors after a newer request or invalidation', async () => {
    const task = latestTask(),
      values: unknown[] = [];
    let resolve!: (v: string) => void, reject!: (e: Error) => void;
    const old = task.run(
      () => new Promise<string>((r) => (resolve = r)),
      (data) => values.push(data),
      (e) => values.push(e),
    );
    await task.run(
      () => Promise.resolve('new'),
      (data) => values.push(data),
      () => {},
    );
    resolve('old');
    await old;
    expect(values).toEqual(['new']);
    const failed = task.run(
      () => new Promise<string>((_, r) => (reject = r)),
      () => {},
      (e) => values.push((e as Error).message),
    );
    task.invalidate();
    reject(new Error('late failure'));
    await failed;
    expect(values).toEqual(['new']);
  });
});

describe('regionRequest', () => {
  const polygon = closePolygon([
    [106, 10],
    [106.1, 10],
    [106, 10.1],
  ]);
  const ok = { polygon, runId: 'base', modified: false, min: '0', max: '15', threshold: '15', height: 100 };
  it('builds the exact request body', () => {
    expect(regionRequest(ok)).toEqual({ polygon, z_min_m: 0, z_max_m: 15, threshold_ug_m3: 15 });
  });
  it('refuses missing input, illustration multipliers, bad heights and thresholds', () => {
    expect(keyOf(() => regionRequest({ ...ok, polygon: null }))).toBe('analysis.validation.noPolygon');
    expect(keyOf(() => regionRequest({ ...ok, runId: null }))).toBe('analysis.validation.noRun');
    expect(keyOf(() => regionRequest({ ...ok, modified: true }))).toBe('analysis.validation.modified');
    for (const [min, max] of [
      ['0', '0'],
      ['5', '2'],
      ['-1', '5'],
      ['0', '101'],
      ['', '5'],
      ['0', 'x'],
    ])
      expect(keyOf(() => regionRequest({ ...ok, min, max }))).toBe('analysis.validation.heightRange');
    try {
      regionRequest({ ...ok, max: '0' });
    } catch (error) {
      expect((error as AppError).params).toEqual({ max: 100 });
    }
    for (const threshold of ['', '-1', 'abc'])
      expect(keyOf(() => regionRequest({ ...ok, threshold }))).toBe('analysis.validation.threshold');
    expect(regionRequest({ ...ok, max: '100', threshold: '0' }).threshold_ug_m3).toBe(0);
  });
});

describe('analysisErrorKey', () => {
  it('translates server validation into actionable keys without echoing raw English', () => {
    const cases: Array<[string, string]> = [
      ['Polygon must be valid with positive area (no self intersections)', 'analysis.error.invalidPolygon'],
      ['Polygon must be fully inside the study area', 'analysis.error.outsideArea'],
      ['Require 0 <= z_min_m < z_max_m <= domain height', 'analysis.error.heightRange'],
      ['Runs must share study area, CRS, grid, scene and model', 'analysis.error.incompatibleRuns'],
      ['unknown validation from database', 'analysis.error.validation'],
    ];
    for (const [message, key] of cases) {
      const result = analysisErrorKey({ message, status: 400, kind: 'validation' });
      expect(result.key).toBe(key);
      for (const locale of ['vi', 'en'] as const)
        expect(translate(locale, result.key, result.params)).not.toMatch(/Polygon|must|study area|database|CRS/);
    }
    expect(translate('vi', analysisErrorKey({ message: cases[0][0], status: 400 }).key)).toMatch(
      /các cạnh cắt nhau/,
    );
  });
  it('reads ApiError.detail, not its i18n-key message', () => {
    const error = new ApiError('validation', 400);
    error.detail = 'Polygon must be fully inside the study area';
    expect(analysisErrorKey(error)).toEqual({ key: 'analysis.error.outsideArea' });
    const bare = new ApiError('validation', 400);
    expect(analysisErrorKey(bare)).toEqual({ key: 'analysis.error.validation' });
  });
  it('classifies status and kind with the legacy precedence', () => {
    expect(analysisErrorKey({ status: 500, message: 'SQL internal detail' }).key).toBe('analysis.error.server');
    expect(analysisErrorKey({ kind: 'timeout' }).key).toBe('analysis.error.timeout');
    expect(analysisErrorKey({ status: 409, message: 'requires succeeded run' }).key).toBe('analysis.error.notSucceeded');
    expect(analysisErrorKey({ status: 404 }).key).toBe('analysis.error.notFound');
    expect(analysisErrorKey(new ApiError('not-found', 404)).key).toBe('analysis.error.notFound');
    expect(analysisErrorKey({ status: 403 }).key).toBe('analysis.error.permission');
    expect(analysisErrorKey({ kind: 'permission' }).key).toBe('analysis.error.permission');
    expect(analysisErrorKey(new ApiError('network')).key).toBe('analysis.error.network');
    expect(analysisErrorKey(new Error('Failed to fetch')).key).toBe('analysis.error.network');
    expect(analysisErrorKey(new Error('Offline')).key).toBe('analysis.error.network');
    expect(analysisErrorKey({ status: 409 }).key).toBe('analysis.error.conflict');
    expect(analysisErrorKey({ kind: 'validation' }).key).toBe('analysis.error.validation');
    expect(analysisErrorKey(new Error('Không tương thích lưới')).key).toBe('analysis.error.unknown');
    expect(analysisErrorKey(undefined).key).toBe('analysis.error.unknown');
    expect(analysisErrorKey('boom').key).toBe('analysis.error.unknown');
  });
  it('keeps client keyed errors with their params', () => {
    expect(analysisErrorKey(new AppError('analysis.validation.heightRange', { max: 100 }))).toEqual({
      key: 'analysis.validation.heightRange',
      params: { max: 100 },
    });
    expect(analysisErrorKey(new AppError('analysis.polygon.shape'))).toEqual({ key: 'analysis.polygon.shape' });
  });
  it('maps Vietnamese transect 400 messages from the API to transect keys', () => {
    const cases: Array<[string, string]> = [
      ['Tuyến cần từ 2 đến 100 điểm.', 'analysis.error.transect.vertices'],
      ['Tuyến phải nằm hoàn toàn trong khu vực mô phỏng.', 'analysis.error.transect.outsideArea'],
      ['Tuyến nằm ngoài lưới hoặc trên biên ngoài cùng. Hãy vẽ vào bên trong.', 'analysis.error.transect.outsideGrid'],
      ['Hai điểm liên tiếp phải khác nhau; tuyến cần có chiều dài.', 'analysis.error.transect.zeroLength'],
      ['Mặt cắt vượt giới hạn 20.000 mẫu.', 'analysis.error.transect.tooManySamples'],
      ['Khoảng cao độ phải nằm trong mô hình, từ thấp đến cao.', 'analysis.error.transect.heightRange'],
      ['Tuyến gì đó khác', 'analysis.error.transect.invalidLine'],
    ];
    for (const [message, key] of cases) expect(analysisErrorKey({ status: 400, message }).key).toBe(key);
    expect(analysisErrorKey({ status: 400, message: 'Bước lấy mẫu phải lớn hơn 0 và không quá 2.5 m.' })).toEqual({
      key: 'analysis.error.transect.step',
      params: { max: 2.5 },
    });
    // Without a 400 status these prefixes are not trusted.
    expect(analysisErrorKey({ status: 409, message: 'Tuyến phải nằm hoàn toàn' }).key).toBe('analysis.error.conflict');
    expect(translate('vi', 'analysis.error.transect.outsideArea')).toMatch(/Tuyến phải/);
  });
});
