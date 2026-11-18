import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StudyAreasService } from './study-areas.service.js';

const polygon = { type: 'Polygon', coordinates: [] };

function setup(exists = true) {
  const model = {
    findAll: vi.fn(async () => [
      {
        id: 'nguyen_hue',
        name: 'Nguyen Hue',
        srid: '32648',
        grid: { nx: 100 },
        west: '106.70',
        south: '10.77',
        east: '106.71',
        north: '10.78',
        minx: '686000',
        miny: '1191000',
        maxx: '686500',
        maxy: '1191500',
        geometry: polygon,
        scene_version: 'scene-v1',
        provenance: null,
      },
    ]),
    exists: vi.fn(async () => exists),
    buildings: vi.fn(async () => [
      {
        source_feature_id: 'way/1',
        height_m: '91.5',
        height_source: 'gob',
        geometry: polygon,
      },
    ]),
    roads: vi.fn(async () => [
      {
        source_feature_id: 'way/2',
        road_class: 'primary',
        emission_weight: '2.5',
        geometry: polygon,
      },
      {
        source_feature_id: 'way/3',
        road_class: 'service',
        emission_weight: null,
        geometry: polygon,
      },
    ]),
    water: vi.fn(async () => [
      { source_feature_id: 'way/4', kind: 'river', geometry: polygon },
    ]),
    green: vi.fn(async () => []),
  };
  return { service: new StudyAreasService(model as never), model };
}

describe('StudyAreasService', () => {
  it('converts numeric bounds and defaults missing provenance', async () => {
    const [area] = await setup().service.list();
    expect(area).toEqual({
      id: 'nguyen_hue',
      name: 'Nguyen Hue',
      srid: 32648,
      grid: { nx: 100 },
      bounds: [106.7, 10.77, 106.71, 10.78],
      bounds_projected: [686000, 1191000, 686500, 1191500],
      geometry: polygon,
      scene_version: 'scene-v1',
      provenance: {},
    });
  });

  it('returns each scene layer as a GeoJSON FeatureCollection', async () => {
    const scene = await setup().service.scene('nguyen_hue');
    expect(scene.study_area_id).toBe('nguyen_hue');
    expect(scene.buildings.features[0]).toEqual({
      type: 'Feature',
      properties: {
        source_feature_id: 'way/1',
        height_m: 91.5,
        height_source: 'gob',
      },
      geometry: polygon,
    });
    // A missing road weight stays null; it is not an emission weight of zero.
    expect(
      scene.roads.features.map((f) => f.properties.emission_weight),
    ).toEqual([2.5, null]);
    expect(scene.water.features[0].properties).toEqual({
      source_feature_id: 'way/4',
      kind: 'river',
    });
    expect(scene.green).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('returns 404 for an unknown area without querying its layers', async () => {
    const { service, model } = setup(false);
    await expect(service.scene('nowhere')).rejects.toThrow(NotFoundException);
    expect(model.buildings).not.toHaveBeenCalled();
  });
});
