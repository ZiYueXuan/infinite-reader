# Opening / closing: paper binding continuity

The left board rotates around the middle of the book thickness. Previously the left
paper stack used the same rigid transform: its root at height `z` moved horizontally
by `(z - hingeHeight) * sin(theta)`. Early in a thick book this exposed a vertical
strip of endpaper, even though the strip disappeared at the fully open endpoint.

`GutterFold` now applies an inverse-rotated horizontal correction within the inner
0.8 book units. The sewn edge stays on the spine plane, world height is preserved,
and the correction smoothly reaches zero outside the binding margin. Resting leaves
and the stack walls/cap share this mapping. Leaf normals and curvature are computed
after deformation; block normals are recomputed. Fully open and closed geometry,
page-turn simulation, and the cover's existing hinge are unchanged.

Validation:

- `cd web && node --experimental-strip-types --test src/engine/gutterFold.test.ts`
  checks attachment at every degree and multiple paper heights, endpoint identity,
  and unchanged coordinates outside the binding margin.
- Open `/scripts/gutter-fold-check.html` on the local Vite server. It compares the
  old rigid geometry and the correction at identical angles, with a close/open
  animation control. `Run geometry regression` checks real rendered mesh roots for
  8, 250, and 1600 leaves at five reading positions over the full angle range.
- Browser run: 444 root checks passed; maximum spine-plane error
  `3.13e-8` book units. Both geometry buffers remain finite.
- Production build passed. Web lint passed with the three existing warnings in
  `check-leaf-profile.mjs`, `fuzz-pointer-sequences.mjs`, and `icons.tsx`.

The comparison uses synthetic pages and does not call production APIs or AI models.
