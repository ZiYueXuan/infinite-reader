# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2.1,<3"]
# ///
"""Build the public-domain coastline mask: uv run scripts/build-atlas-water.py."""

import gzip
import hashlib
import json
import math
from pathlib import Path
from urllib.request import urlopen

from shapely import make_valid, set_precision
from shapely.geometry import box, mapping, shape

REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson"
OUTPUT = Path(__file__).resolve().parents[1] / "public/atlas/water.json"
CELL_DEGREES = 10


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(item) for item in value]
    return round(value, 5) if isinstance(value, float) else value


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygons(part)


def partition(geometry):
    """Keep tile clipping/triangulation local instead of bridging continental holes."""
    for polygon in polygons(geometry):
        west, south, east, north = polygon.bounds
        if east - west <= CELL_DEGREES and north - south <= CELL_DEGREES:
            yield polygon
            continue
        for x in range(math.floor(west / CELL_DEGREES), math.ceil(east / CELL_DEGREES)):
            for y in range(math.floor(south / CELL_DEGREES), math.ceil(north / CELL_DEGREES)):
                cell = box(x * CELL_DEGREES, y * CELL_DEGREES,
                           (x + 1) * CELL_DEGREES, (y + 1) * CELL_DEGREES)
                yield from polygons(polygon.intersection(cell))


def main():
    features = []
    for name in ("ne_10m_ocean", "ne_10m_lakes"):
        raw = urlopen(f"{BASE}/{name}.geojson", timeout=60).read()
        print(f"{name}: sha256={hashlib.sha256(raw).hexdigest()}")
        for feature in json.loads(raw)["features"]:
            geometry = make_valid(shape(feature["geometry"]))
            # Regional coastline precision. Preserve islands/holes before partitioning.
            simplified = set_precision(geometry.simplify(0.003, preserve_topology=True), 0.00001)
            for part in partition(simplified):
                for polygon in polygons(set_precision(part, 0.00001)):
                    if polygon.is_empty:
                        continue
                    data = mapping(polygon)
                    data["coordinates"] = rounded(data["coordinates"])
                    assert shape(data).is_valid, f"Invalid water geometry in {name}"
                    features.append({"type": "Feature", "properties": {}, "geometry": data})
    result = {"type": "FeatureCollection", "features": features}
    encoded = json.dumps(result, separators=(",", ":")).encode()
    OUTPUT.write_bytes(encoded)
    print(f"{len(features)} water polygons: {len(encoded):,} bytes ({len(gzip.compress(encoded)):,} gzip)")


if __name__ == "__main__":
    main()
