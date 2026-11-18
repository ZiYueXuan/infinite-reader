# Atlas lazy-module recovery

The dialog has separate failure paths: AtlasDialog handles importing the globe component; AtlasMap handles WebGL and map resource errors after that import succeeds. The reported screen had the former message and no map controls.

During investigation, the current production AtlasMap module imported successfully. An older hashed AtlasMap URL returned HTTP 200 with `text/html` (the SPA fallback) instead of JavaScript. A page held open across deployments can therefore fail when it first opens this lazy feature. The old Reload action retried the same missing module URL, so it could not update the entry/module graph; browsers may also retain failed module loads in the current document.

Component-load failures now offer an explicit full-page refresh, with Chinese/English text asking the reader to reopen the map and explaining that saved recognition results remain. This fetches the current entry graph. It does not invoke recognition or alter stored map data. WebGL/resource retry remains local to AtlasMap. Import errors are logged for diagnosis.

`check-atlas-reload.mjs` runs against a production build. It injects the observed HTML-for-JS response, checks that the original image and place list remain, clicks Refresh page, reopens the map and verifies the globe/controls recover. It also blocks optional external DEM tiles and verifies the bundled base globe stays available. API fixtures prevent account writes and AI calls.

This fixes recovery, not indefinite compatibility for pages held open across deployments: old hashed chunks are still absent from the current asset manifest, so a stale page may need one explicit refresh.
