/** Core deck.gl layers of the viewer (port of the layer functions in web/app.js). */
import type { Layer, PickingInfo } from '@deck.gl/core';
import { GeoJsonLayer, PathLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { FeatureCollection } from '../api/types';
import { WALL_MATERIAL, detailOpacity, material, type Appearance, type FacadePolygon } from '../lib/buildingAppearance';
import { activeThresholds, cellColour, colourScale, valueAt } from '../lib/concentration';
import { advance, createField, createParticles, streamlet, type FlowField, type Particle } from '../lib/flow';
import { geoAt, outline, type Cell, type GridLine, type NodeFn } from '../lib/grid';
import type { LodController, LodCamera } from '../lib/lod';
import type { BootstrapData, RunData, ViewerState } from '../store/types';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface CoreContext {
  state: ViewerState;
  bootstrap: BootstrapData;
  run: RunData | null;
  node: NodeFn;
  cells: Cell[];
  gridLines: GridLine[];
  appearance: Appearance;
  lod: LodController;
  camera: LodCamera;
  drawing: boolean;
  suppressConcentration: boolean;
  onCellClick(cell: Cell): void;
  onBuildingClick(id: string): void;
}

export function concentrationLayer(ctx: CoreContext): Layer | null {
  const { state, bootstrap, run } = ctx;
  if (ctx.suppressConcentration || !run) return null;
  const grid = bootstrap.grid;
  const z = grid.z_centres_m[state.layer];
  const scale = colourScale(run.volume.scale, state.display);
  const thresholds = activeThresholds(bootstrap.thresholds, state.thresholdsEnabled);
  const k = state.layer;
  const key = [run.id, state.layer, state.display.multiplier, state.display.background, thresholds.map((t) => t.key).join()];
  return new SolidPolygonLayer<Cell>({
    id: 'concentration',
    data: ctx.cells,
    extruded: false,
    pickable: state.mapMode === 'cell' && !ctx.drawing,
    getPolygon: (cell) => [
      [...ctx.node(cell.i, cell.j), z],
      [...ctx.node(cell.i + 1, cell.j), z],
      [...ctx.node(cell.i + 1, cell.j + 1), z],
      [...ctx.node(cell.i, cell.j + 1), z],
    ],
    getFillColor: (cell) => cellColour(valueAt(run.volume, grid, state.display, k, cell.j, cell.i), scale, thresholds),
    updateTriggers: { getPolygon: [z], getFillColor: key },
    onClick: (info: PickingInfo<Cell>) => {
      if (state.mapMode !== 'cell' || ctx.drawing) return;
      if (info.object) ctx.onCellClick(info.object);
    },
    parameters: { depthWriteEnabled: false },
  });
}

export function buildingLayer(ctx: CoreContext): Layer {
  const { state } = ctx;
  return new GeoJsonLayer({
    id: 'buildings',
    data: ctx.bootstrap.scene.buildings as never,
    visible: state.layers.buildings,
    extruded: true,
    filled: true,
    wireframe: false,
    opacity: state.layers.facades ? 1 : 0.55,
    getElevation: (f: { properties: { height_m: number } }) => f.properties.height_m,
    getFillColor: material as never,
    getLineColor: [199, 207, 206],
    material: WALL_MATERIAL,
    pickable: state.mapMode === 'pan' && !ctx.drawing,
    onClick: (info: PickingInfo) => {
      const id = (info.object as { properties?: { source_feature_id?: string } } | undefined)?.properties?.source_feature_id;
      if (id) ctx.onBuildingClick(id);
    },
  });
}

export function facadeLayers(ctx: CoreContext): Layer[] {
  const { state } = ctx;
  if (!state.layers.buildings || !state.layers.facades) return [];
  const plan = ctx.lod(ctx.camera);
  if (!plan.polygons) return [];
  const opacity = detailOpacity(ctx.camera.getZoom());
  const out: Layer[] = [];
  if (plan.frames.length)
    out.push(
      new SolidPolygonLayer<FacadePolygon>({
        id: 'facade-sills',
        data: plan.frames,
        opacity: opacity * 0.65,
        _full3d: true,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => d.color,
        material: false,
      }),
    );
  out.push(
    new SolidPolygonLayer<FacadePolygon>({
      id: 'facade-windows',
      data: plan.windows,
      opacity,
      _full3d: true,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      material: false,
      pickable: state.mapMode === 'pan' && !ctx.drawing,
      onClick: (info: PickingInfo<FacadePolygon>) => {
        if (info.object) ctx.onBuildingClick(info.object.id);
      },
    }),
  );
  return out;
}

export function roadLayer(ctx: CoreContext): Layer {
  return new GeoJsonLayer({
    id: 'roads',
    data: (ctx.bootstrap.scene.roads || EMPTY) as never,
    visible: ctx.state.layers.roads,
    stroked: true,
    filled: false,
    lineWidthUnits: 'meters',
    getLineWidth: (f: { properties: { emission_share: number } }) => 1 + 250 * f.properties.emission_share,
    getLineColor: [107, 126, 116, 200],
  });
}

export function waterLayer(ctx: CoreContext): Layer {
  return new GeoJsonLayer({
    id: 'water',
    data: (ctx.bootstrap.scene.water || EMPTY) as never,
    stroked: false,
    filled: true,
    getFillColor: [14, 116, 144, 150],
  });
}

export function greenLayer(ctx: CoreContext): Layer {
  return new GeoJsonLayer({
    id: 'green',
    data: (ctx.bootstrap.scene.green || EMPTY) as never,
    stroked: false,
    filled: true,
    getFillColor: [127, 151, 115, 95],
  });
}

export function selectionLayer(ctx: CoreContext): Layer | null {
  const { state } = ctx;
  if (!state.selectedCell || !ctx.run) return null;
  return new PathLayer<{ path: number[][] }>({
    id: 'selection',
    data: [{ path: outline(state.selectedCell, ctx.node, ctx.bootstrap.grid.z_centres_m[state.layer] + 0.08) }],
    getPath: (d) => d.path as never,
    getColor: [66, 106, 133, 255],
    getWidth: 2.5,
    widthUnits: 'pixels',
    pickable: false,
    parameters: { depthWriteEnabled: false },
  });
}

export function voxelGridLayer(ctx: CoreContext): Layer | null {
  if (!ctx.run || !ctx.state.layers.grid) return null;
  const z = ctx.bootstrap.grid.z_centres_m[ctx.state.layer] + 0.04;
  return new PathLayer<GridLine>({
    id: 'voxel-grid',
    data: ctx.gridLines,
    getPath: (d) => d.path.map((p) => [...p, z]) as never,
    getColor: (d) => [75, 95, 109, d.major ? 115 : 58],
    getWidth: (d) => (d.major ? 1 : 0.5),
    widthUnits: 'pixels',
    pickable: false,
    updateTriggers: { getPath: [z] },
    parameters: { depthWriteEnabled: false },
  });
}

// --------------------------------------------------------------------------
// wind
// --------------------------------------------------------------------------

export interface WindState {
  key: string | null;
  field: FlowField | null;
  particles: Particle[];
}

export function createWindState(): WindState {
  return { key: null, field: null, particles: [] };
}

/** Rebuild the flow field when the run or layer changes (legacy ensureWindFlow). */
export function ensureWind(wind: WindState, bootstrap: BootstrapData, run: RunData | null, layer: number): void {
  const key = `${run?.id ?? ''}:${layer}`;
  if (key === wind.key && wind.field) return;
  wind.key = key;
  const grid = bootstrap.grid;
  wind.field = run
    ? createField(run.windField, grid, (x, y, z) => {
        const i = Math.floor(x / grid.dx_m),
          j = Math.floor(y / grid.dy_m),
          k = Math.floor(z / grid.dz_m);
        return run.volume.codes[(k * grid.ny + j) * grid.nx + i] !== 0;
      })
    : null;
  wind.particles = createParticles(wind.field, layer);
}

export function advanceWind(wind: WindState, seconds: number): void {
  // Displayed 6× faster than real time so motion is visible.
  advance(wind.field, wind.particles, seconds * 6);
}

interface WindSegment {
  path: number[][];
  alpha: number;
  width: number;
}

function windSegments(wind: WindState, bootstrap: BootstrapData): WindSegment[] {
  if (!wind.field) return [];
  const grid = bootstrap.grid;
  return wind.particles.flatMap((particle) => {
    const points = streamlet(wind.field, particle);
    if (points.length < 3) return [];
    const path = points.map(([x, y, z]) => [...geoAt(bootstrap.corners, x / (grid.nx * grid.dx_m), y / (grid.ny * grid.dy_m)), z + 0.15]);
    return path.slice(1).map((point, index) => {
      const t = (index + 0.5) / (path.length - 1);
      // Fade both ends, brighter toward the moving head, without arrowheads.
      const envelope = Math.pow(Math.sin(Math.PI * t), 0.7) * (0.3 + 0.7 * t);
      return { path: [path[index], point], alpha: Math.round(220 * particle.fade * envelope), width: 0.6 + 1.1 * envelope };
    });
  });
}

export function windLayers(wind: WindState, bootstrap: BootstrapData, visible: boolean): Layer[] {
  const data = visible ? windSegments(wind, bootstrap) : [];
  return [
    new PathLayer<WindSegment>({
      id: 'wind-trails',
      data,
      visible,
      getPath: (item) => item.path as never,
      getColor: (item) => [112, 156, 170, Math.round(item.alpha * 0.3)],
      getWidth: (item) => item.width + 2,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true,
      parameters: { depthWriteEnabled: false },
    }),
    new PathLayer<WindSegment>({
      id: 'wind-streamlets',
      data,
      visible,
      getPath: (item) => item.path as never,
      getColor: (item) => [248, 253, 255, item.alpha],
      getWidth: (item) => item.width,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true,
      parameters: { depthWriteEnabled: false },
    }),
  ];
}
