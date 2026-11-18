# Atlas elevation color continuity — 2026-10-25

## Diagnosis and upstream comparison

The in-app browser reproduces the pale mountain relief around Kabul at
`[69.2, 34.6]`, zoom `6.5`, pitch `0`, after elevation, shading, and water sources
finish loading. Disabling hillshade still leaves pale highlands. Disabling
atmosphere does not materially change this view. Both the elevation palette and
the white slope highlights contribute; this is not a missing-tile symptom.

Compared the current GitHub `book-space-time` renderer with its local copy;
both have blob `1f0b4f0b8c888c1c98f3e72bc179af365c8dae5d`:

- Upstream uses `#a87f54` at 4000 m and `#cbb78f` at 5000 m, with a 58%-opaque
  live color layer over pre-rendered relief. Its hillshade strength is `0.2`
  with a pale highlight (`#fff6dd`).
- Our preceding style used `#e0d4bd` already at 4300 m and `#faf7ef` at 5600 m,
  with 100% live color by zoom 4.5 and hillshade strength `0.35` using `#fff8e4`.
  The zoom-3 global raster and the live close-up palette were different.
- Upstream has the same general risk of pale highlights and layered relief,
  but our palette and zoom transition intensified it. This comparison verifies
  upstream source settings, not a visual acceptance of its deployed app.

Source: https://github.com/book-space-time/blob/2a7377ce56605aee85c57f504d38b9256db25672/apps/web/components/maplibre-dem-globe.tsx#L407-L480

## Change

- Use one elevation palette at all zoom levels. Higher zoom loads finer DEM
  detail without replacing the palette with a pale close-up style.
- Keep typical mountain elevations in earthy midtones. Elevation alone does not
  identify snow cover, so moderate highlands are not painted near-white.
- Use MapLibre's built-in Igor hillshade with transparent highlights. Shadows
  describe slope relief while preserving the elevation color. Its strength is
  not numerically comparable to the preceding standard hillshade algorithm.
- Retain the independent water mask, the fallback raster, and real DEM geometry
  for 3D terrain. No data-source, dependency, API, or persistence change.
- The development-only preview exposes location, zoom, shading, atmosphere,
  and tile-readiness controls for reproducible browser inspection.

## Verification

- Official MapLibre style validation passed.
- All 9 atlas catalog, coastline, and terrain-navigation tests passed.
- Production build passed; lint reported no errors and 3 existing warnings.
- In-app browser: same-view Kabul before/after, further zoom, Italy coastlines,
  global view, and Alps at zoom 10.5 / pitch 65 with terrain enabled.
- No browser errors in the local preview; all inspected views reached loaded
  source state. Before/after and hillshade-ablation screenshots are retained
  in the task's visualization directory.

The underlying DEM still has finite resolution, and Natural Earth coastlines
remain regional reference data. This change addresses washed-out styling and
zoom color continuity; it does not turn the map into satellite imagery.

## Production verification

Deployed Worker version `worker-version-id`.
The live entry is `index-72-Vzbab.js`; the map chunk `AtlasMap-Bmmkgq03.js`
matches the local production build byte-for-byte, SHA-256
`4477cff87cf3c16f64462d81c471fc5199820f330d12b0d4aabe1068c1f28b8c`.

In the signed-in in-app browser, reopened the actual Mughal Empire book map,
selected Kabul, and zoomed in once, matching the pre-deploy interaction and
viewport. Mountains retained their color with visible ridge/valley contrast;
the console contained no errors. Production before/after screenshots are saved
as `atlas-production-kabul-before.png` and `atlas-production-kabul-after.png`
in the task visualization directory.
