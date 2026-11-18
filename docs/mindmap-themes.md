# Mind-map theme research and implementation

Research date: 2026-10-31. References are official product documentation and galleries, not a comparative hands-on review of paid applications. The palettes and preview artwork in Infinite Reader are original; no competitor assets or theme files are bundled.

| Reference | Relevant pattern | Application in Infinite Reader |
| --- | --- | --- |
| [Xmind: Color Theme](https://xmind.com/user-guide/color-theme-new) and [Colored Branch](https://xmind.com/user-guide/branch-new) | Coordinated palettes and color assignment by branch | Six restrained branch colors per theme; descendants retain the first-level branch color |
| [MindNode: Themes](https://www.mindnode.com/support/guides/themes) and [theme gallery](https://www.mindnode.com/themes) | Themes coordinate typography, shapes and branch styling; gallery includes light/dark directions | Five complete presets, including type, shape, surface, canvas and connection treatment |
| [MindMeister: Customize Your Map’s Appearance](https://support.mindmeister.com/hc/en-us/articles/360017494280-Customize-Your-Map-s-Appearance) | Theme selection provides a consistent map-wide appearance; shapes, borders and connecting lines are styled together | Small diagram previews and instant switching of the entire map UI |
| [Coggle](https://coggle.it/) | Branch-oriented diagram presentation and control over line styles/paths | Curved connections with a lighter visual weight than node cards |

## The five presets

| ID | 中文 / English | Visual direction |
| --- | --- | --- |
| porcelain | 清瓷 / Porcelain | Default. Cool white canvas, blue root, restrained multicolor branches, rounded cards and subtle shadows |
| ink | 纸墨 / Ink | Warm paper, system serif typography, fine curves, square corners and underlined leaf labels |
| grove | 森境 / Grove | Deep forest, moss and brass, pale root, alternating organic corners |
| midnight | 午夜 / Midnight | Deep navy, soft lavender/teal branches, faint square grid and dark layered cards |
| sand | 暖砂 / Warm Sand | Cream, terracotta and sage, generous rounded corners and warm soft shadows |

Root nodes carry the greatest weight; first-level nodes use a restrained branch tint and stronger type; deeper nodes are quieter. Child counts remain round badges on the node edge and follow the branch palette instead of a universal red. Curved SVG links connect actual node bounds and decrease in weight after the first level. All labels remain inert React text.

## Behavior and persistence

The palette button in the map toolbar opens a five-card picker. Picking a theme keeps the panel open for comparison. Escape closes the picker first and restores focus; another Escape closes the map. Outside click dismisses the picker. Buttons use pressed states and keyboard activation. Chinese and English names, descriptions and accessibility labels are translated.

The theme is a browser-wide display preference (`ir:mindmap-theme`), independent of the reader’s book theme, map contents and account records. It survives dialog reopen and page reload, and changes sync between tabs via the storage event. Invalid stored values fall back to Porcelain. If local storage is blocked, selection still works for the current session. It is not currently synced between devices.

Changing themes does not fetch status, generate a map, mutate saved JSON, change collapsed branches or reset pan/zoom. The same theme applies to chapter and highlight maps. New maps default to Porcelain. No backend change or migration is needed.

A ResizeObserver measures node geometry and updates an SVG overlay after layout/font/collapse changes. Coordinates are normalized to the unscaled tree, so panning and zooming transform nodes and curves together. Background/text changes are immediate to avoid unreadable intermediate frames when switching between light and dark themes. Reduced-motion preferences disable node transitions.

## Validation

Browser regression checks cover the existing canvas gestures, branch expansion, saved-map reuse, five previews, distinct surfaces, rendered text contrast of at least 4.5:1 on tested node/toolbar surfaces, connection endpoints across all themes, pan/zoom/collapse preservation, zero additional requests on theme change, reload persistence, invalid storage fallback, keyboard dismissal and narrow viewport bounds. The highlight-map toolbar/dialog suite also passes. Test API responses are intercepted; no paid model calls are made.

### First-open connections regression (2026-11-06)

Connection measurement must start after the ancestor tree ref is attached. A child layout effect ran before that ref was available and returned without measuring or installing its ResizeObserver. Production maps therefore opened with nodes but no SVG paths; expanding/collapsing could accidentally initialize them later. Development Strict Mode could also mask the bug by rerunning the effect. The connection effect now runs after the commit.

Both browser suites check edge count, visible strokes, and endpoints immediately after every initial/saved/reloaded map opens, before any branch interactions. Run against a production build (`npm --prefix web run build`, then `npm --prefix web run preview`) to cover the actual mounting lifecycle. API fixtures prevent paid inference and account writes.
