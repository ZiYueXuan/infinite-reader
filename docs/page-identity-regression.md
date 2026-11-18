# Page identity during rapid turns

## Confirmed defect

The drag entry point did not share the ordering restrictions already partly present in `turn()`.
With two forward sheets in flight, starting a backward drag after 30 simulated 60 Hz frames
could leave the settled leaf states as `[0, 1, 0, ...]` (right, left, right). The spread count
was 1, but the visible right leaf was 0 rather than 1. Different click timing produced
`[1, 0, 0, ...]` instead. This can make rendered content disagree with spread-based UI.
A cancelled drag could similarly be overtaken by another forward turn.

A fully settled single forward/backward turn in the production book returned the title page
correctly during investigation. The reported intermittent screenshot was not independently
reproduced in that exact single-turn sequence; the rapid-turn ordering defect above was reproduced.

## Change

`BookModel.canStartTurn()` is shared by pointer and programmatic turns. It prevents starting
another turn while holding a sheet or the cover, opposing sheets in flight, overtaking a sheet
returning to its original stack, and exceeding the existing six-sheet limit. Same-direction
fan turns remain supported. No EPUB content, pagination, or texture rasterization was changed.

## Verification

Open `/scripts/page-identity-check.html` on the local Vite server in the in-app browser and
press **Run turn regression**. `check-page-identity.mjs` uses detached real book models with
8, 250, and 1600 leaves. It checks both directions, different click timings, cancellation,
keyboard/pointer overlap, same-direction fan turns, repeated first-page round trips, texture
identity, and stationary-press visibility at three raycast positions for 30 consecutive frames.

Result: 57 scenarios, 2183 assertions, zero failures. Production build passed. Lint passed
with the same three pre-existing warnings (two unused script variables and the icon-module
React refresh warning).

Deployment: `worker-version-id`.
Frontend entry: `index-Bn13iX8A.js`.

Live verification: the in-app browser loaded the new frontend entry. In the actual
波斯之剑 book, clicking the right edge revealed the EPUB cover, and clicking the left
edge returned to the generated title page after settling.
