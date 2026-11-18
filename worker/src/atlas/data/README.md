# City coordinate reference

Source: [https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson)

Natural Earth populated places (1:10m), public domain. This server-only subset contains 7342 cities/towns. It is not an exhaustive historical gazetteer.

Source SHA-256: `fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f`.

Rows: `[ne_id, name, iso_a2, longitude, latitude, aliases]`.
Regenerate with `python3 scripts/build-atlas-gazetteer.py` from worker/. Review data changes before release.
Only unambiguous name + country matches are used; unknown/ambiguous places are omitted, never assigned model-generated coordinates.
