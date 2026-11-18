# Atlas river and water layers — 2026-11-13

The physical Atlas now combines a bundled regional river network with detailed
OpenStreetMap water tiles. Both image-derived maps and text-place maps use the
same `AtlasMap` / `atlasStyle` implementation.

## Data and presentation

- `public/atlas/rivers.json`: 4,224 Natural Earth 1:10m scale-ranked river segments,
  including 4,036 segments with upstream simplified-Chinese names. These are
  segments, not counts of distinct rivers. English/local names remain fallbacks.
- The reproducible builder is `scripts/build-atlas-rivers.py`. It uses the same
  pinned Natural Earth revision as the existing water mask and keeps geometry,
  source names, display ranks and minimum label zooms. Input SHA-256:
  `65dca1bd1729a347dda0837f41b5d152252e33abd2d7ff3370a0539c33bdf89b`.
  Output: 6,265,676 bytes / 1,967,811 gzip. No model-generated geography or names.
- At zoom 8+, `https://tiles.openfreemap.org/planet` supplies the OpenMapTiles
  `water`, `waterway`, and `water_name` layers. Only these water layers are drawn;
  roads, buildings and boundaries from the tiles are not rendered.
- Detailed water polygons replace the generalized coastline/lake mask once the
  visible detail source has loaded. River lines and readable labels overlay the
  terrain; intermittent waterways are dashed and underground channels are hidden.
- Chinese UI prefers `name:zh-Hans`, then `name:zh`, then the source's local name.
  English UI prefers English names. Labels use local fonts supported by MapLibre
  6; no external font service or additional font downloads are introduced.
- Zoom now reaches 14 (DEM still max 14). OpenMapTiles has rivers at lower detail
  zooms, canals from 12, and smaller stream/drain classes from 13. Coverage and
  names depend on the source; this is modern hydrography, not historical courses.

## Failure and cost behavior

The existing ocean/lake mask and bundled river lines remain visible until detail
loads. A detail error restores this fallback for that map session. A 15-second
stall shows a localized notice and restores fallback; successfully arriving tiles
can recover from a stall. Event listeners and timers are removed with the map.
The globe, elevation, book pins and normal reading remain available.

There are no AI, search, geocoding, D1 or R2 operations for these layers. Regional
rivers are ordinary static site assets; detailed tiles are requested directly by
the browser for the current viewport. OpenFreeMap's public service currently has
no API key or usage fee and no SLA. Chinese-mainland network availability has not
been independently measured; the bundled fallback avoids depending on it for the
major river network. Map tiles contain more features than the water layers drawn,
so network transfer is not limited to water-only bytes. The normal source credits
include Natural Earth, Mapzen, OpenFreeMap, OpenMapTiles and OpenStreetMap.

## Validation

- 14 targeted tests: both locale styles pass MapLibre validation, empty/missing
  name fallbacks, multilingual global data, initial failure, delayed recovery,
  subsequent failure, cleanup, and existing terrain/coastline triangulation tests.
- Browser: Shanghai at z11 / pitch 65 shows Huangpu River, Wusong River and nearby
  waterways with Chinese labels and detailed water polygons.
- Browser: London at z12 displays the Thames with its upstream Chinese label,
  surrounding canals, detailed water polygons and retained book markers.
- Browser: Shanghai at z14 loads river, canal, stream and drain classes.
- Blocking OpenFreeMap before page load preserves the Shanxi/Fen River fallback
  at z9, shows the detail notice and leaves the map usable.

## Sources

- https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/
- https://openfreemap.org/ and https://openfreemap.org/quick_start/
- https://github.com/openmaptiles/openmaptiles/blob/master/layers/waterway/waterway.yaml
- https://maplibre.org/maplibre-style-spec/glyphs/

## Production

Worker version `worker-version-id` deployed at 100%.
The live `/atlas/rivers.json` returns HTTP 200 and matches the local artifact:
`da763c925b8c6b084edb4c32f9f1b17cc97196e221011ec0976b49f7261bb52f`.
