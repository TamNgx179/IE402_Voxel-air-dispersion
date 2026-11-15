import { ScatterplotLayer } from '@deck.gl/layers';

/** Keep every accepted vertex visible before there is a line to render. */
export function drawingVertices(id: string, points: number[][], height: number) {
  return new ScatterplotLayer<number[]>({
    id,
    data: points,
    getPosition: ([lng, lat]) => [lng, lat, height],
    radiusUnits: 'pixels',
    getRadius: 5,
    stroked: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 2,
    getFillColor: [15, 104, 143],
    getLineColor: [255, 255, 255],
    parameters: { depthCompare: 'always' },
    pickable: false,
  });
}
