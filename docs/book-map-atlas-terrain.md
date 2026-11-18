# Atlas 3D terrain — 2026-10-24

## Cause and behavior

The former terrain toggle enabled the DEM but only tilted to 45 degrees and
ensured zoom 4.7; the map itself stopped at zoom 8. This left users at continental
or ocean scales, while the default hillshade already suggested relief visually.
The DEM sources also stopped at level 10, limiting close-up detail.

- The button is now explicitly named `3D 地形`. It enters a 65-degree local view
  at zoom 10.5, keeping the existing 1.25x height exaggeration.
- Selected locations and close views retain their geographic focus. From an
  overview, bounded sampling of already loaded DEMs chooses relief inside the
  book map, then refines that location with regional DEMs before the final flight.
  Ocean, missing, or flat samples fall back to a book location; no fictional
  heights, hard-coded mountain destinations, or recognition requests are added.
- The map zoom limit is 12. Independent elevation-color, hillshade, and terrain
  sources now load DEMs through level 14 from the existing public provider.
- Toggling off returns to the entry view. Region/global controls exit terrain,
  and manually zooming out below level 6 returns to the overview mode.
- Loading is explicit. Pointer/keyboard/wheel interaction cancels pending auto
  focus. Terrain errors or a 15-second load deadline fall back to a flat view,
  clearing the active button. Timers and listeners are removed on cleanup.

`atlas/terrainView.ts` isolates the small sampling policy and shared view limits;
the React map owns lifecycle and interaction. No library, server schema,
credential, or persisted book data changes are needed.

## Validation

Unit fixtures cover ocean-centered maps, missing/flat data, antimeridian bounds,
and local refinement staying near the chosen range. Existing map-identification
and coastline fixtures remain part of the regression command.

In-app browser checks exercise the actual React map through the development-only
`scripts/atlas-preview.html`, including global and regional entry, selected-city
and existing-local views, restoration, and the maximum zoom. Terrarium levels
11, 12, and 14 were also independently fetched successfully (HTTP 200).

- `node --test src/atlas/terrainView.test.ts src/atlas/catalog.test.ts src/atlas/water.test.ts`:
  9 passed. Production build passed; lint has no errors and four pre-existing warnings.
- Western Europe overview entry landed near `[1.59375, 42.625]` in the Pyrenees at
  zoom 10.5 / pitch 65. Local Mont Blanc entry retained `[6.865, 45.833]`; zoom 12
  loaded DEM level 14 and displayed actual peaks and valleys.
- Selected Bern retained `[7.466976, 46.916683]`. Returning to the original view,
  region/global exit, cancelling by global button, and cancelling by real pointer
  drag all cleared pending camera movement.
- A missing terrain-only tile URL kept the base map, displayed the non-fatal
  notice, reset pitch, and cleared the active terrain button.
- A synthetic ocean-centered map spanning the Atlantic selected land within its
  bounds with reduced motion enabled. Narrow-viewport controls remained within
  the viewport with distinct button hit areas.

Natural Earth remains a regional coastline source. This is a physical terrain
view, not a satellite surface or a reconstruction of historical boundaries.

References:
- https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- https://github.com/tilezen/joerd/blob/master/docs/formats.md
- https://registry.opendata.aws/terrain-tiles/

## Production acceptance

Deployed Worker version `worker-version-id` to
`https://reader.example.workers.dev`.
The signed-in in-app browser loaded `index-w0y49q19.js` and
`AtlasMap-DpSaqCBP.js`. Opening the real book's Western Europe atlas and clicking
`3D 地形` completed the automatic mountain approach, with visibly raised ridges
and valleys, `aria-busy=false`, the active button retained, and no fallback notice.
Live terrain requests reached DEM level 13 in that viewport. The production
screenshot and release/resource verification JSON are saved with the task artifacts.
