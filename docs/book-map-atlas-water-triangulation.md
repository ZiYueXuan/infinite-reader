# Atlas cross-land water artifacts — 2026-10-25

## Reproduction and cause

The in-app browser reproduces the reported blue ribbon over India at center
`[78, 23]`, zoom `4.5`, pitch `0`, with all map sources loaded. Hiding the water
layer removes it. Switching globe to Mercator retains it, so globe projection
alone is not responsible. The source polygons are valid and do not classify
points along the ribbon as water.

The actual MapLibre GeoJSON tiler, ring classifier and Earcut triangulator
generate triangles that cover `[74, 23.05]` and `[78, 23.05]` at tile zooms 3–4.
At `[78, 23.05]`, the clipped polygon's point-in-ring result remains land but
the triangles cover it as water. This establishes a triangulation artifact,
not a river, DEM value, or an AI-recognized feature.

The new `waterMesh.test.ts` regression fails on the previous production mask
(`India 74,23.05 at z3: true !== false`) and passes after partitioning. Tests
use the renderer's installed tiling and triangulation packages and style
source settings, rather than checking only raw GeoJSON containment.

## Fix

The offline mask builder partitions large water polygons into geographic cells
at most 10 degrees wide/tall, preserving islands and holes. Each resulting
polygon is an independent feature. This avoids continental-size holes/bridges
passing through the tile clipping and triangulation pipeline. No special-case
rectangle over India, projection change, or renderer dependency upgrade.

Pinned Natural Earth source hashes are unchanged. The generated asset contains
2,373 valid polygons, 8,221,832 bytes / 2,765,514 gzip. Comparing the union with
the old mask gives a symmetric-difference fraction of `6.87e-9`; the small
difference comes from the existing 0.00001-degree coordinate precision at cut
intersections. Polygon boundaries are not new lakes or rivers.

## Verification

- All 12 atlas tests pass, including the new rendered-mesh regressions for
  India at tile zooms 3–7, ocean coverage across partition boundaries, islands,
  land below sea level, inland lakes, Greenland, and the date line.
- In-app browser: India at zoom 3.5, 4.5 and 5.5; the original ribbon is absent.
  Greenland at zoom 2.5 retains the land/sea outline.
- Original and repaired same-view screenshots are retained as
  `atlas-india-seam-before.png` and `atlas-india-seam-after.png` in task artifacts.
- Production build and lint passed (3 existing lint warnings). The first build
  exposed an upstream intersection-type issue for transformed tile geometry in
  the regression test; explicitly typing returned tile features resolved it.

## Production deployment

Worker version `worker-version-id` serves the revised mask.
`/atlas/water.json` returns HTTP 200 and matches the local build byte-for-byte:
SHA-256 `cb5d1f148ee782742dcae87326fb0679d7ef01e6917c61b504975d0c1391efbf`.
The frontend JavaScript hashes are unchanged because the runtime style and
interaction code did not change. The water asset requires cache revalidation.

Production browser acceptance reopened the actual Mughal Empire map, selected
Delhi, then zoomed out once, matching the pre-deployment view and viewport.
The cross-India ribbon is gone and the browser error log is empty. Evidence:
`atlas-india-production-before.png` and `atlas-india-production-after.png` in
the task visualization directory.

This repairs spurious water triangles. It does not claim to eliminate unrelated
DEM color/LOD seams or improve the regional coastline dataset's resolution.
