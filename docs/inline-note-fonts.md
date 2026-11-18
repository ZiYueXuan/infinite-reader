# Inline note fonts

Open a note and choose **Aa** to set that note's font. New notes default to LXGW WenKai, whether created from a selection or added to an existing mark. Existing notes retain their saved font; older notes without a font still follow the reading font. The choices are LXGW WenKai, Ma Shan Zheng, Long Cang, Zhi Mang Xing, Caveat, Noto Serif SC, and Noto Sans SC. Caveat is a Latin handwriting font; Chinese text uses WenKai. The note's text and tags share the selected family; the original passage retains its reading font and highlight colour.

All bundled choices use SIL Open Font License 1.1, which permits commercial use subject to its conditions. Full upstream copyright and license notices are retained in `web/public/fonts/` and linked from `/fonts/licenses.html` and the chooser. Fonts are served from the application, with only the selected families and needed Unicode subsets loaded. No external font service is required.

The optional stable `note.font` ID is stored in IndexedDB and in the existing server note anchor JSON. No database migration is needed. Missing or unknown IDs follow the reading font. Font changes participate in sync and layout signatures. Measurements, page canvas rendering, and background workers receive the same loaded font assets, including for continuation pages. Failed downloads leave the previous choice intact; selecting the current font does not repaginate.

Validation: frontend font/signature and pagination tests, Worker note API round trips, and `web/scripts/check-inline-notes.mjs`. The browser regression covers real font downloads, download failure, editor and worker fonts, mobile menu bounds, no-op Done, reload, long-note continuation, and independence from the reading font and ink colours.
