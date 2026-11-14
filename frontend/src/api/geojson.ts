/** Minimal GeoJSON types (WGS84 at the web boundary). */
export type Position = number[];

export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface Feature<P = Record<string, unknown>, G extends Geometry = Geometry> {
  type: 'Feature';
  id?: string | number;
  properties: P;
  geometry: G;
}

export interface FeatureCollection<P = Record<string, unknown>, G extends Geometry = Geometry> {
  type: 'FeatureCollection';
  features: Array<Feature<P, G>>;
}
