# City coordinate reference

Source: [https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson)

Natural Earth populated places (1:10m), public domain. This server-only subset contains 7342 cities/towns. It is not an exhaustive historical gazetteer.

Source SHA-256: `fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f`.

Rows: `[ne_id, name, iso_a2, longitude, latitude, aliases]`.
Regenerate with `python3 scripts/build-atlas-gazetteer.py` from worker/. Review data changes before release.
Only unambiguous name + country matches are used; unknown/ambiguous places are omitted, never assigned model-generated coordinates.

## Han spelling variants for the text gazetteer

`han-spellings.json` is derived from OpenCC 1.4.2's STCharacters and TSCharacters dictionaries, distributed under Apache 2.0. Each string contains one simplified and one traditional code point. The generator retains only reciprocal pairs with no other variant in either dictionary. It excludes ambiguous characters such as 发, even when one reading is more common. [Source dictionaries](https://github.com/BYVoid/OpenCC/tree/ver.1.4.2/data/dictionary) · [License](./OpenCC-LICENSE.txt)

From `worker/`, run `python3 scripts/build-han-spellings.py /path/to/OpenCC/data/dictionary src/atlas/data/han-spellings.json`. The script verifies both source hashes. The Worker uses the checked-in table and the existing GeoNames packs.
