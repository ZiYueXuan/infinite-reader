# Atlas zoom clarity — 2026-10-24

## Reproduction and cause

In the in-app browser, center `[12.5, 43]`, zoom `6`, pitch `0` reproduces the
washed-out Italy view after all raster and DEM sources finish loading. Requests
succeed, so this is not an incomplete tile load.

The old style kept the zoom-3 raster visible under a 76%-opaque live DEM layer.
It also used a one-metre transition between blue (`-1 m`) and green (`0 m`) to
classify water, then shaded both land and seabed. DEM values are not a coastline:
sampled coastal tiles `7/67/46`, `7/68/46`, and `7/69/46` contain respectively
260, 254, and 2,520 pixels inside the Natural Earth ocean polygon with elevations
at or above zero. Conversely, the Flevoland land fixture `[5.54, 52.45]` has a
Terrarium elevation of `-6 m`.

## Change

- Live elevation becomes fully opaque by zoom 4.5, with a gradual transition
  from zoom 3. The low-resolution raster remains available underneath on failure.
- An independent Natural Earth 1:10m ocean/lake mask draws above elevation and
  hillshade. Water remains calm; elevations below sea level can still be land.
- Land colors and shading have more contrast, with map-anchored lighting.
- A failed coastline source disables land-only DEM colors and shading, avoiding
  a green ocean. Existing tile-failure messaging and bundled relief remain.
- `atlas/mapStyle.ts` owns the style; `AtlasMap.tsx` retains interaction/lifecycle.
  No renderer dependency upgrade, new API key, recognition change, or book-data
  change is needed.

The mask's pinned sources, regeneration command and transfer size are documented
in `web/public/atlas/README.md`. Natural Earth provides regional reference
coastlines, not street-level precision or historical political borders.

## Verification

- `node --test src/atlas/catalog.test.ts src/atlas/water.test.ts`: 5 passed.
  Fixtures cover real islands, land below sea level, coastal water, inland lakes,
  and both sides of the date line.
- `npm run build`: passed. `npm run lint`: no errors; four existing warnings.
- `scripts/atlas-preview.html` exercises the production React map with no login
  or book upload. It is not an entry point in the production build.
- In-app browser: Italy at zoom 6, 7, and maximum 8; 45-degree terrain; global
  view; denied DEM requests retain the base map and show a detail-unavailable
  notice. Same-view before/after screenshots are saved with the task artifacts.
- Missing coastline URL in the local preview: both live elevation and shading
  become `visibility: none`, with a non-fatal fallback notice. This exercises the
  worker-loaded GeoJSON failure path as well as ordinary DEM request failures.

## Production verification

Deployed Worker version `worker-version-id`.
In the signed-in in-app browser, opened the actual book's Western Europe map,
selected Rome, then used the map's zoom-in button. The production entry was
`index-BRA_xakt.js`, and the lazy map chunk was `AtlasMap-CDN8wyBT.js`.
DEM levels 4–7 loaded with no HTTP failures, fallback notice, or browser errors.
`/atlas/water.json` returned HTTP 200 with `zstd` compression; its decoded SHA-256
matched the local build: `699cc90db13fce40ac85f00be76562a8dd7751814853e5a7fb32ed673bee626c`.

References:
- https://maplibre.org/maplibre-style-spec/layers/
- https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-ocean/
- https://www.naturalearthdata.com/about/terms-of-use/
- https://github.com/tilezen/joerd/blob/master/docs/formats.md
