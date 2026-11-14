/**
 * Copy owned by the analysis panel (src/panels/) and the pure analysis libs
 * (src/lib/{analysis,transect,corridor,export}.ts). Add keys here; the vi file must
 * mirror every key (enforced by the Messages<typeof en> type).
 */
const analysis = {
  toolLabel: 'Analysis',
  title: 'Advanced analysis',

  // Errors classified from API failures (lib/analysis.ts analysisErrorKey).
  'error.invalidPolygon':
    'The drawn area is not valid. Draw it again, avoiding crossing edges or points on a single straight line.',
  'error.outsideArea':
    'The selected area is outside the simulation area. Draw it again entirely inside the area that has data.',
  'error.heightRange':
    'The height range is not valid. Choose heights inside the model and make the start height lower than the end height.',
  'error.incompatibleRuns':
    'The two results do not share the same grid or building model, so they cannot be compared. Choose another result.',
  'error.notSucceeded': 'The simulation has not finished. Choose a result that ran successfully.',
  'error.notFound': 'The simulation result was not found. Please select the result again.',
  'error.permission': 'You do not have permission to access this result.',
  'error.timeout': 'The request took too long. Please try again.',
  'error.network': 'Lost connection to the application. Check your connection and try again.',
  'error.server': 'The system could not process the request. Please try again later.',
  'error.conflict': 'The current result is not ready for analysis. Choose a finished result and try again.',
  'error.validation': 'The analysis input is not valid. Check the area, heights and reference threshold.',
  'error.unknown': 'The action could not be completed. Please try again.',
  'error.csvFailed': 'Could not download the data table. {reason}',

  // Server-side vertical-section validation (Vietnamese server messages mapped to keys).
  'error.transect.vertices': 'A line needs 2 to 100 points.',
  'error.transect.outsideArea': 'The line must lie entirely inside the simulation area.',
  'error.transect.outsideGrid': 'The line is outside the grid or on its outermost edge. Draw it further inside.',
  'error.transect.zeroLength': 'Consecutive points must differ; the line needs a length.',
  'error.transect.step': 'The sampling step must be greater than 0 and at most {max} m.',
  'error.transect.tooManySamples':
    'The section exceeds the 20,000-sample limit. Shorten the line, narrow the height range or increase the sampling step.',
  'error.transect.heightRange': 'The height range must be inside the model, from low to high.',
  'error.transect.invalidLine': 'The line is not valid. Draw it again.',

  // Server-side corridor validation.
  'error.corridor.roadMismatch': 'Some road segments do not belong to the scene of this result. Select the roads again.',

  // Client-side polygon validation (closePolygon / polygonShape).
  'polygon.minVertices': 'At least 3 vertices are needed.',
  'polygon.invalidVertices': 'Invalid coordinates or too many vertices.',
  'polygon.shape': 'A GeoJSON Polygon with 1–20 rings is required.',
  'polygon.ringSize': 'Each ring needs at least 4 coordinates, including the closing point.',
  'polygon.maxCoordinates': 'At most 500 coordinates.',
  'polygon.coordinates': 'Use finite longitude/latitude pairs, without a z coordinate.',
  'polygon.ringClosed': 'Polygon rings must be closed.',

  // Client-side request validation shared by region / corridor.
  'validation.noPolygon': 'Select or enter an area first.',
  'validation.noRun': 'There is no baseline result yet.',
  'validation.modified': 'Set the multiplier to ×1 and the background to 0 to see the original data.',
  'validation.heightRange': 'Enter a height range: 0 ≤ from < to ≤ {max} m.',
  'validation.threshold': 'The reference threshold must be a non-negative number.',

  // Vertical section (transect) drawing and request validation.
  'transect.noLine': 'Draw a line first.',
  'transect.noRun': 'Choose a simulation result first.',
  'transect.modified': 'Set the multiplier to ×1 and the background to 0 to see the original data.',
  'transect.heightRange': 'Choose a height range: 0 ≤ from < to ≤ {max} m.',
  'transect.maxPoints': 'At most {max} points per line.',
  'transect.readingSolid': 'Building',
  'transect.readingNoData': 'No data',
  'transect.readingAir': '{value} µg/m³',
  'transect.reading': '{distance} m from the line start · layer centre {z} m · cell ({i}, {j}, {k}): {reading}',

  // Road corridor request validation and labels.
  'corridor.distanceCount': 'Enter 1–{max} distance marks, for example 10, 25, 50.',
  'corridor.distanceRange': 'Each distance mark must be from 0.1 to 100 m.',
  'corridor.distanceOrder': 'Distance marks must increase, without duplicates.',
  'corridor.noRoads': 'Select at least one road segment.',
  'corridor.maxRoads': 'Select at most {max} road segments.',
  'corridor.noRun': 'There is no baseline result yet.',
  'corridor.roadLabel': 'Segment {index} · {kind} · {length} m',
  'corridor.class.primary': 'primary road',
  'corridor.class.secondary': 'secondary road',
  'corridor.class.tertiary': 'tertiary road',
  'corridor.class.residential': 'residential road',
  'corridor.class.service': 'service road',
  'corridor.class.unclassified': 'other road',
  'corridor.class.default': 'road',

  // Comparison legend (lib/export.ts comparisonLegend).
  'legend.compareEmptyTitle': 'No comparison data at this layer',
  'legend.compareEmptyLabel': 'No shared air cells with data',
  'legend.deltaZeroTitle': 'Difference equals 0 (µg/m³)',
  'legend.deltaZeroLabel': '0 · No difference at this layer',
  'legend.deltaTitle': 'ΔC (µg/m³, symmetric linear scale)',
  'legend.concentrationTitle': 'Concentration (µg/m³, shared linear scale)',

  // Report image / PNG export (lib/export.ts).
  'export.mapNotReady': 'The map is not ready yet.',
  'export.pngFailed': 'Could not create the PNG image.',
  'export.pngCors': 'The basemap does not allow image export (CORS). Change the basemap and try again.',
} as const;
export default analysis;
