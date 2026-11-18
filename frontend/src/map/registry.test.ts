import type { Layer, PickingInfo } from '@deck.gl/core';
import { describe, expect, test, vi } from 'vitest';
import { MapRegistry, type MapClickEvent } from './registry';

const layer = (id: string) => ({ id }) as unknown as Layer;
const click = { lngLat: [106.7, 10.77], point: [1, 2], pick: () => null, originalEvent: undefined } as MapClickEvent;

function contribution(ids: string[], overrides: Partial<Parameters<MapRegistry['setLayers']>[1] & object> = {}) {
  return { layers: ids.map(layer), slot: 'top' as const, suppressConcentration: false, ...overrides };
}

describe('MapRegistry layers', () => {
  test('groups contributed layers by slot in registration order and drops empty entries', () => {
    const registry = new MapRegistry();
    registry.setLayers('a', contribution(['a1', 'a2']));
    registry.setLayers('b', { layers: [layer('b1'), null, false, undefined], slot: 'below-concentration', suppressConcentration: false });
    registry.setLayers('c', contribution(['c1']));

    expect(registry.layers('top').map((l) => l.id)).toEqual(['a1', 'a2', 'c1']);
    expect(registry.layers('below-concentration').map((l) => l.id)).toEqual(['b1']);
    expect(registry.layers('above-concentration')).toEqual([]);
  });

  test('replacing a contribution keeps its position; removing it clears its layers', () => {
    const registry = new MapRegistry();
    registry.setLayers('a', contribution(['a1']));
    registry.setLayers('b', contribution(['b1']));
    registry.setLayers('a', contribution(['a2']));
    expect(registry.layers('top').map((l) => l.id)).toEqual(['a2', 'b1']);
    registry.setLayers('a', null);
    expect(registry.layers('top').map((l) => l.id)).toEqual(['b1']);
  });

  test('concentration is suppressed while any contribution asks for it', () => {
    const registry = new MapRegistry();
    registry.setLayers('region', contribution([]));
    expect(registry.concentrationSuppressed()).toBe(false);
    registry.setLayers('compare', contribution([], { suppressConcentration: true }));
    expect(registry.concentrationSuppressed()).toBe(true);
    registry.setLayers('compare', null);
    expect(registry.concentrationSuppressed()).toBe(false);
  });

  test('tooltip returns the first non-empty contribution text', () => {
    const registry = new MapRegistry();
    const info = { layer: layer('x') } as unknown as PickingInfo;
    registry.setLayers('silent', contribution([], { tooltip: () => null }));
    registry.setLayers('empty', contribution([], { tooltip: () => '' }));
    registry.setLayers('named', contribution([], { tooltip: (i) => `layer ${i.layer?.id}` }));
    registry.setLayers('late', contribution([], { tooltip: () => 'never reached' }));
    expect(registry.tooltip(info)).toBe('layer x');
    expect(new MapRegistry().tooltip(info)).toBeNull();
  });
});

describe('MapRegistry change notifications', () => {
  test('every real layer change bumps the version and notifies subscribers', () => {
    const registry = new MapRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const start = registry.getVersion();

    registry.setLayers('a', contribution(['a1']));
    registry.setLayers('a', null);
    // Removing an id that is not registered is not a change.
    registry.setLayers('a', null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getVersion()).toBe(start + 2);

    unsubscribe();
    registry.setLayers('b', contribution(['b1']));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getVersion()).toBe(start + 3);
  });

  test('a handler swap does not re-render; drawing changes and releases do', () => {
    const registry = new MapRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const key = Symbol('cell');

    registry.claim(key, { handler: () => undefined, drawing: false });
    registry.claim(key, { handler: () => undefined, drawing: false });
    expect(listener).not.toHaveBeenCalled();

    registry.claim(key, { handler: () => undefined, drawing: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.isDrawing()).toBe(true);

    registry.claim(key, null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.isDrawing()).toBe(false);

    // Releasing an unknown claim is a no-op.
    registry.claim(Symbol('other'), null);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('MapRegistry clicks', () => {
  test('drawing stays on while any drawing claim remains', () => {
    const registry = new MapRegistry();
    const region = Symbol('region'),
      transect = Symbol('transect');
    registry.claim(region, { handler: () => undefined, drawing: true });
    registry.claim(transect, { handler: () => undefined, drawing: true });
    registry.claim(region, null);
    expect(registry.isDrawing()).toBe(true);
    registry.claim(transect, null);
    expect(registry.isDrawing()).toBe(false);
  });

  test('dispatches one click to every claim, even if a handler releases its claim', () => {
    const registry = new MapRegistry();
    const seen: string[] = [];
    const first = Symbol('first');
    registry.claim(first, {
      handler: () => {
        seen.push('first');
        registry.claim(first, null);
      },
      drawing: false,
    });
    registry.claim(Symbol('second'), { handler: (event) => seen.push(`second ${event.lngLat.join(',')}`), drawing: false });

    registry.dispatchClick(click);
    expect(seen).toEqual(['first', 'second 106.7,10.77']);
    registry.dispatchClick(click);
    expect(seen).toEqual(['first', 'second 106.7,10.77', 'second 106.7,10.77']);
  });
});
