"""Generate a compact, server-only city index from Natural Earth's public-domain data."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson"
raw = urlopen(URL).read()
rows = []
for feature in json.loads(raw)["features"]:
    p = feature["properties"]
    aliases = list(dict.fromkeys(filter(None, [p.get("nameascii"), *(p.get("namealt") or "").split("|")])) )
    rows.append([str(p["ne_id"]), p["name"], p["iso_a2"], round(p["longitude"], 6), round(p["latitude"], 6), aliases])
dest = Path(__file__).resolve().parents[1] / "src/atlas/data"
dest.mkdir(parents=True, exist_ok=True)
(dest / "cities.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n")
(dest / "README.md").write_text(f"""# City coordinate reference

Source: [{URL}]({URL})

Natural Earth populated places (1:10m), public domain. This server-only subset contains {len(rows)} cities/towns. It is not an exhaustive historical gazetteer.

Source SHA-256: `{hashlib.sha256(raw).hexdigest()}`.

Rows: `[ne_id, name, iso_a2, longitude, latitude, aliases]`.
Regenerate with `python3 scripts/build-atlas-gazetteer.py` from worker/. Review data changes before release.
Only unambiguous name + country matches are used; unknown/ambiguous places are omitted, never assigned model-generated coordinates.
""")
print(f"Wrote {len(rows)} places ({(dest / 'cities.json').stat().st_size} bytes)")
