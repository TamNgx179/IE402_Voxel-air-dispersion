# frontend — React + TypeScript WebGIS viewer

Phase 2 rewrite of the vanilla viewer in `web/` (see `docs/UPGRADE_PLAN.md`). Same
rendering stack (MapLibre GL 5.24.0 + deck.gl 9.4.0, bundled from npm so the demo
works offline) and the same REST contract under `/api`.

| | |
|---|---|
| Dev server | `npm run dev` → http://localhost:5173, proxies `/api` to http://localhost:3000 |
| Production | `npm run build` → `frontend/dist`, served by NestJS at `/` |
| Legacy viewer | still served unchanged at `/legacy/` |

```bash
cd frontend
npm ci
npm test              # Vitest (jsdom)
npx tsc --noEmit      # strict type check
npm run build         # tsc + vite build → dist/
npm run dev           # needs the API: see app/README.md (npm run start:dev in app/)
```

If `frontend/dist/index.html` does not exist, NestJS falls back to the legacy viewer at `/`.

## Structure

```text
src/
├── main.tsx, App.tsx          # providers + shell (sidebar, map, overlays)
├── api/                       # REST client (client.ts) and response types (types.ts)
├── i18n/                      # I18nProvider, dictionaries en/<ns>.ts + vi/<ns>.ts
├── lib/                       # pure, tested logic (grid, flow, lod, concentration, evidence, …)
├── store/                     # viewer store: types, reducer (actions), selectors, controller (async)
├── map/                       # MapView (MapLibre + deck), core layers, contribution registry + hooks
├── export/                    # report snapshot + export contributions
├── components/                # core UI (result card, map chrome, tool nav/host, help tooltip, evidence)
├── panels/                    # tool panels — ONE directory per panel, ONE registry file
│   ├── index.ts               # PANELS registry (the only shared file)
│   ├── types.ts               # PanelDefinition / PanelProps
│   ├── simulation/            # placeholder
│   ├── map-options/           # placeholder
│   ├── stats/                 # placeholder
│   ├── analysis/              # host with sub-mode switch; modes.ts registry
│   │   ├── region/ compare/ transect/ corridor/   # placeholders
│   └── illustration/          # complete reference panel
├── styles/viewer.css          # verbatim copy of web/styles.css (legacy ids/classes kept)
├── styles/app.css             # React-only additions
└── test/                      # setup, fixtures (fakeApi), fakeMap
public/vendor/bootstrap-icons  # copied from web/vendor (offline icon font)
```

Shared files that panel work should **not** need to touch: `App.tsx`, `store/*`,
`map/*`, `export/*`, `components/*`, `i18n/index.tsx`. Each panel owns its directory
and its i18n namespace files. The only shared edits are one line in
`panels/index.ts` (already present for the four placeholder panels) and, for a
brand-new namespace, two lines in `i18n/dictionaries.ts`.

## Store

`store/store.tsx` is a tiny external store (reducer + `useSyncExternalStore`).

```ts
import { useViewer, useViewerDispatch } from '../../store/store';
import { useViewerActions } from '../../store/controller';
import { selectCurrentRun, selectExact, selectZ } from '../../store/selectors';

const layer = useViewer((s) => s.layer);          // re-renders only when the slice changes
const run = useViewer(selectCurrentRun);           // RunData | null
const dispatch = useViewerDispatch();
dispatch({ type: 'layer/set', layer: 3 });
```

Selectors must return existing objects or primitives (no new arrays/objects inside
the selector — derive with `useMemo`).

### State (`store/types.ts` → `ViewerState`)

| Field | Meaning |
|---|---|
| `bootstrap` | `{ status: 'loading'\|'ready'\|'error', data: BootstrapData\|null, error }`. `data` has `area`, `grid` (+ `z_centres_m`), `corners`, `scenarios` (runnable), `thresholds` (`key → {value,label}`), `scene` (buildings/roads/water/green GeoJSON), `provenance`, `quality` |
| `runs` | completed runs for the result select (`RunEntry[]`, newest added first) |
| `selectedRunId` / `pendingRunId` | shown run / run being fetched |
| `runData` | `id → RunData` cache: `volume` (decoded uint8 codes + LUT), `summary`, `windField` |
| `layer` | height layer index k |
| `display` | `{ multiplier, background }` illustration (1/0 = original data, see `selectExact`) |
| `thresholdsEnabled` | `key → boolean` (threshold colouring) |
| `selectedCell` | `{ i, j }` or null |
| `selectedBuildingId` | building clicked on the map (map-options shows it) |
| `mapMode` | `'pan' \| 'cell'` |
| `activePanel` | open tool panel id or null |
| `layers` | `{ buildings, facades, roads, wind, grid }` visibility |
| `windPaused` | wind animation paused by the user |
| `basemap` | `'vector' \| 'raster'` (MapView applies it; automatic fallback sets `'raster'`) |
| `queries` | exact API queries: `areas['<run>:<k>']` (m² per threshold), `profiles['<run>:<i>:<j>']`, `status`, `error` |
| `status` | bottom status box: `{ message: {key, params}, kind, retry?, error? }` |

### Actions (`store/reducer.ts` → `ViewerAction`)

| Action | Effect |
|---|---|
| `bootstrap/loaded` `{data, runs}` · `bootstrap/failed` `{error}` · `bootstrap/retry` | start-up lifecycle (normally via `loadBootstrap()`) |
| `runs/added` `{entry}` | prepend a completed run to the select (no-op if listed) |
| `run/pending` `{id}` · `run/loaded` `{data}` · `run/select` `{id}` | run loading/selection (normally via `selectResult()`) |
| `layer/set` `{layer}` | clamp to `0..nz-1` |
| `display/set` `{display: Partial<Display>}` · `display/reset` | illustration; invalid values fall back to 1 / 0 |
| `threshold/toggle` `{key, enabled}` | threshold colouring + legend markers |
| `cell/select` `{cell \| null}` | selected cell (outline, info box, profile query) |
| `building/select` `{id \| null}` | selected building |
| `mapMode/set` `{mode}` | `'pan'` or `'cell'` picking |
| `panel/open` `{id \| null}` | open a tool panel (or close all) |
| `layers/set` `{layer, visible}` | toggle `buildings`, `facades`, `roads`, `wind`, `grid` |
| `wind/paused` `{paused}` | pause/resume streamlets |
| `basemap/set` `{basemap}` | `'vector'` or `'raster'` |
| `queries/*` | internal to the exact-query scheduler |
| `status/set` `{status}` | status box message (i18n key) with optional retry |

Run, layer, display, cell and toggles survive run switches and language changes.

### Async operations (`useViewerActions()`, `store/controller.tsx`)

```ts
loadBootstrap(): Promise<void>          // (re)load everything, then show the default run
selectResult(id): Promise<void>         // load (cached) + show; last call wins
ensureRun(id): Promise<RunData>         // load + cache without selecting (e.g. comparison)
addCompletedRun(run: RunView): Promise<void>  // simulation panel: add a succeeded run and show it
retryQueries(): void                    // re-run failed exceedance/profile queries
```

Exceedance areas for the current layer and the selected cell's profile are fetched
automatically (debounced 180 ms) in exact mode.

### `useApi(): ApiFn` (`store/controller.tsx`)

```ts
import { useApi } from '../../store/controller';
const api = useApi();
const result = await api<RegionResult>(`/runs/${id}/region`, { method: 'POST', body });
```

The REST function given to `<App api>` / `<ViewerActionsProvider api>` (tests pass
`fakeApi()` or `routedApi(…)`), else the real client from `api/client.ts` (also
outside the provider). Panels use `useApi()` instead of importing `api` directly, so
tests inject endpoints through the App rather than `vi.mock`.

## REST client (`api/client.ts`)

In panels get the function with `useApi()` (above); its call signature is `api`'s:

```ts
import { api, request, ApiError, AppError, errorMessage } from '../../api/client';
const runs = await api<RunListItem[]>('/runs?status=succeeded');          // GET /api/runs…
await api<RunAccepted>('/runs', { method: 'POST', body: JSON.stringify(body) });
const csv = await api<string>(`/runs/${id}/region/csv`, { method: 'POST', body, responseType: 'text' });
```

- `timeoutMs` (default 20000) is combined with an optional caller `signal`.
- Failures throw `ApiError` with `kind`: `timeout | network | invalid | not-found | conflict | permission | server | validation`, `status`, and `detail` (raw server text — for classification only, never render it).
- **Nothing is retried automatically.** A POST that creates a simulation must keep a stable `request_id` (legacy kept it in `sessionStorage` per scenario/multiplier until the server confirmed).
- Show errors with `const { key, params } = errorMessage(error); t(key, params)`. Throw `new AppError('<ns>.<key>', params)` for your own user-facing errors.

## i18n

No third-party library. `I18nProvider` (in `App`) + `useI18n()`:

```ts
const { t, locale, setLocale, formatNumber, formatInteger } = useI18n();
t('viewer.heightValueText', { level: 3, min: '4', max: '6' });
formatNumber(12.345);                  // en "12.3", vi "12,3"; null/NaN → "–"; 0 → "0"
formatNumber(v, { maximumFractionDigits: 0 });
formatInteger(12345.6);                // en "12,346", vi "12.346"
```

- English is the default; Vietnamese is selectable with the EN/VI switch in the panel header. The choice is stored in `localStorage['voxel-locale']` (guarded with try/catch) and sets `<html lang>` and `document.title`.
- Dictionaries: `src/i18n/en/<namespace>.ts` (`const x = {...} as const; export default x;`) and `src/i18n/vi/<namespace>.ts` typed `Messages<typeof en>` — a missing or extra Vietnamese key is a compile error. `i18n.test.tsx` also checks that both languages use the same `{placeholders}`.
- Keys are flat within a namespace and may contain dots (`'api.timeout'`); reference them as `'<namespace>.<key>'`. `TranslationKey` is the union of all keys, so `t()` is type-checked. For computed keys, cast: ``t(`evidence.quality.all.${k}` as TranslationKey)``.
- Placeholders: `{name}`; pass already formatted numbers (`formatNumber`) as params.
- Namespaces already registered: `common`, `errors`, `viewer`, `evidence`, `export`, `simulation`, `mapOptions`, `stats`, `analysis`, `region`, `compare`, `transect`, `corridor`, `illustration`. Panel namespaces currently contain `toolLabel`/`modeLabel` and `title`; add your keys to your own pair of files. A new namespace needs two import lines + two entries in `i18n/dictionaries.ts`.
- Vietnamese copy: port the existing text from `web/` verbatim; write proper English for `en`.
- **Machine-readable output is never translated**: CSV headers, JSON metadata keys, units (`µg/m³`, `ug m-3`, `_m`, `_m2`, `_m3` suffixes), run ids and numeric values in files stay identical in both languages. Use `lib/export.ts` (`csv`, `layerCsv`, `csvBlob`, `jsonBlob`, `download`) — numbers in CSV are raw `String(value)`, never `formatNumber`.
- Language changes must not reset panel state: keep state keyed by data, not by translated strings.

## Panel registry

`src/panels/index.ts`:

```ts
export const PANELS: readonly PanelDefinition[] = [simulationPanel, mapOptionsPanel, statsPanel, analysisPanel, illustrationPanel];
```

`src/panels/types.ts`:

```ts
interface PanelProps { active: boolean }
interface PanelDefinition {
  id: string;                      // 'simulation' | 'map-options' | 'stats' | 'analysis' | 'illustration'
  icon: string;                    // bootstrap icon without 'bi-', e.g. 'play-fill'
  labelKey: TranslationKey;        // tool button label (and the section aria-label by default)
  ariaLabelKey?: TranslationKey;   // section aria-label when it differs (stats: legacy "Statistics and selected cell")
  Component: ComponentType<PanelProps>;
  elementId?: string;              // DOM id of the <section class="tool-panel">; default `panel-<id>`
  Persistent?: ComponentType;      // always-visible content below the panels (e.g. run progress)
}
```

- Each placeholder exports a fixed name (`simulationPanel`, `mapOptionsPanel`, `statsPanel`, `analysisPanel`) from `panels/<name>/index.tsx`. Replace the component, keep the export name and `id`.
- The host renders every panel **always mounted** inside `<section class="tool-panel" id={elementId} hidden={!active}>`, so state survives tool switches. Use `active` to stop work when hidden (cancel drawing, disable click claims).
- Legacy DOM ids are preserved for CSS: `simulation-options`, `map-options`, `analysis-details` (stats), `spatial-analysis` (analysis), `illustration-options`. Rules in `styles/viewer.css` such as `#analysis-details .stat` therefore still apply. Put panel-specific CSS in your directory (`import './panel.css'`).
- Open a panel from code: `dispatch({ type: 'panel/open', id: 'map-options' })`. A cell click opens `stats`; a building click opens `map-options` and sets `selectedBuildingId`.
- `panels/illustration/` is a complete small example (store reads/writes, i18n, help tooltip).
- Help tooltips: `<HelpTrigger label={t('x.helpLabel')} text={t('x.help')} />` from `components/Help.tsx`.
- Ready-made components: `components/RunEvidence.tsx` (`<RunEvidence />`, legacy `#run-evidence`), `components/ResultCard.tsx` exports `Legend`/`HeightControl`.

### Analysis sub-modes

`panels/analysis/index.tsx` renders a mode switch over `ANALYSIS_MODES` in
`panels/analysis/modes.ts` (order: region, transect, compare, corridor). Each mode
lives in `panels/analysis/<mode>/index.tsx` and exports
`{ id, labelKey, Component }` (`regionMode`, `transectMode`, `compareMode`,
`corridorMode`). `Component` receives `{ active }` = analysis panel open **and**
this mode selected; all modes stay mounted. Cancel drawing when `active` turns false.

## Map extension API (`src/map/hooks.tsx`)

```ts
import { useMapLayers, useMapClick, useIsDrawing, useMapInstance } from '../../map/hooks';
```

### `useMapLayers(id: string, layers: LayerList | null, options?: MapLayersOptions): void`

```ts
type LayerList = ReadonlyArray<Layer | null | false | undefined>;
interface MapLayersOptions {
  slot?: 'below-concentration' | 'above-concentration' | 'top';   // default 'above-concentration'
  suppressConcentration?: boolean;   // hide the core concentration layer and its legend (e.g. comparison view)
  tooltip?: (info: PickingInfo) => string | null;                  // hover text for your objects
}
```

Draw order: water, green, roads, *below-concentration*, concentration,
*above-concentration*, voxel grid, buildings, facades, selected-cell outline, *top*, wind.
The map redraws whenever the array identity changes — build layers in `useMemo`.
Pass `null`/`[]` to contribute nothing; the contribution is removed on unmount.
Prefix both the contribution id and every deck layer id with your panel name
(`'region-outline'`). Use `selectZ`/`state.layer` for the current altitude. Core
layer ids: `water`, `green`, `roads`, `concentration`, `voxel-grid`, `buildings`,
`facade-sills`, `facade-windows`, `selection`, `wind-trails`, `wind-streamlets`.

```tsx
const z = useViewer(selectZ);
const layers = useMemo(() => [new PathLayer({ id: 'region-outline', data, getPath: (d) => d.path, … })], [data, z]);
useMapLayers('region', active ? layers : null);
```

### `useMapClick(handler: (event: MapClickEvent) => void, options?: { enabled?: boolean; drawing?: boolean }): void`

```ts
interface MapClickEvent {
  lngLat: [number, number];          // WGS84
  point: [number, number];           // canvas pixels
  pick(layerIds?: string[]): PickingInfo | null;   // deck pick under the click
  originalEvent: MouseEvent | undefined;
}
```

Every enabled claim receives every map click (latest handler is always used). While
**any** claim has `drawing: true` and `enabled: true`:
cell picking and building/facade picks are off, the Pan/Pick-cell buttons are
disabled, drag-pan is disabled, the cursor is a crosshair, and `buildReport` refuses
to export. Typical drawing panel:

```ts
useMapClick((e) => setPoints((p) => [...p, e.lngLat]), { enabled: active && drawing, drawing: true });
```

Disable double-click zoom while drawing yourself if needed (the test fake map has a
`doubleClickZoom` stub with `isEnabled/enable/disable`):
`useMapInstance()?.map.doubleClickZoom.disable()` (restore on finish/cancel). Handle
Escape in your panel (the help tooltip consumes Escape first when it is open).

### `useIsDrawing(): boolean`, `useConcentrationSuppressed(): boolean` and `useMapInstance(): MapInstance | null`

`useConcentrationSuppressed()` is true while any contribution passes
`suppressConcentration`; the core legend in `ResultCard` hides itself then.

```ts
interface MapInstance {
  map: maplibregl.Map;
  overlay: MapboxOverlay;
  resetView(duration?: number): void;
  renderLod(): { level: string; vertices: number };
  redraw(): void;
  /** Re-render, force one deck frame, call onFrame once right after deck drew it. Returns cancel. */
  captureFrame(onFrame: (deckCanvas: HTMLCanvasElement | null) => void): () => void;
}
```

`captureFrame` is how the PNG export copies the deck canvas while it still holds the
frame (copy inside the callback). Do not set `onAfterRender` on the overlay yourself.

`null` before the map exists and after unmount — always null-check. Do not call
`map.remove()`, `overlay.setProps({layers})` or replace the style yourself (use
`basemap/set`).

## Export contributions (`src/export/ExportProvider.tsx`)

```ts
useExportContribution(key: string, getValue: () => unknown, options?: { target?: 'metadata' | 'report' }): void;
useReportSnapshot(): () => Report;   // throws AppError('export.noRun' | 'export.finishDrawing' | yours)
```

- `getValue` is called at export time; its result goes to `report.metadata[key]`
  (default) or top-level `report[key]` with `target: 'report'`. Return `null` when
  there is nothing to export. Throw an `AppError` to block the export (e.g. "wait for
  the comparison to load").
- Use the legacy keys: `region`, `transect`, `road_corridor`, `comparison_run_id`
  (metadata) and `comparison` (report). Keys are snake_case with units in the name and
  are never translated.
- `Report` (`export/report.ts`): `title`, `summary`, `mode`, `metadata` (`run_id`,
  `model_version`, `input_hash`, `z_requested_m`, `z_center_m`, `z_min_m`, `z_max_m`,
  `units`, `exported_at`, `locale`, `grid`, `provenance`, `scene_quality`, `camera`,
  `illustration`, `thresholds`, `basemap`, `selected_cell`, `render_lod`, `layers`, +
  contributions), `attribution`, `notice`, `legend`. Only `title`, `mode`, `notice` and
  `legend` text follow the UI language. When a `comparison` is contributed (report
  target), `buildReport` appends `export.comparisonNotice` to the notice itself and
  skips the threshold notice/legend; contributors override only `mode`/`legend`. `reportKey(report)` gives a stable identity
  (without `exported_at`) for PNG capture consistency checks.
- File/CSV helpers: `lib/export.ts`.

## Testing

```bash
npm test                 # all Vitest suites
npx vitest run src/lib   # one folder
npx tsc --noEmit
```

- `src/lib/*.test.ts` are ports of `web/tests/*.test.cjs` (grid, flow, LoD, building
  appearance, evidence, milestones) — numerical behaviour is unchanged.
- `src/test/fixtures.ts` → `fakeApi(overrides)`: an in-memory API (2×2×3 grid, two runs,
  one threshold). Override a route with a value or an `Error` instance.
  `routedApi(match, handler, base = fakeApi())` sends paths matching a RegExp (or
  `(path, options) => boolean`) to `handler` and the rest to `base`; pass it as
  `<App api>` to serve a panel's endpoints (reached through `useApi()`).
- `src/test/fakeMap.ts` → `createFakeMapFactory()`: a MapLibre/deck stand-in; render
  `<App store={createViewerStore()} api={fakeApi()} mapFactory={fake.factory} panels={[...]}/>`
  and inspect `fake.overlays[0].setProps` calls for layer ids. See `src/App.test.tsx`.
  `fake.maps[0].doubleClickZoom` is a stateful stub (`isEnabled()`, `enable`/`disable`
  spies); `fake.overlays[0]._deck.redraw()` runs the overlay's `onAfterRender` like
  a deck frame (drives `captureFrame`).
- Simulation tests: `configureSimulationTracker(store, { sleep })` injects the poll
  delay before the tracker is first used; the tracker's API is the App's `useApi()`.
- jsdom has no WebGL; never instantiate the real map in tests.
- Legacy tests stay in `web/tests` (`node --test web/tests/*.test.cjs scripts/tests/*.test.mjs`).

## Accessibility and layout

Legacy labels, `aria-*` and ids are kept. All controls are native buttons/inputs and
keyboard operable; the help tooltip opens on focus and closes on Escape. The layout
reuses `web/styles.css`; at 390 px and 320 px the panel docks to the bottom without
horizontal scroll (checked with headless Chrome in both languages).
