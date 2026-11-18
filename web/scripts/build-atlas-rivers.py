"""Build the bundled, multilingual Natural Earth river fallback (no runtime AI).

python3 scripts/build-atlas-rivers.py [--input /path/to/upstream.geojson]
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

REVISION = 'ca96624a56bd078437bca8184e78163e5039ad19'
URL = f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/ne_10m_rivers_lake_centerlines_scale_rank.geojson'
OUTPUT = Path(__file__).resolve().parents[1] / 'public/atlas/rivers.json'


def rounded(value):
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return round(value, 5) if isinstance(value, float) else value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    args = parser.parse_args()
    raw = args.input.read_bytes() if args.input else urlopen(URL, timeout=60).read()
    features = []
    for feature in json.loads(raw)['features']:
        p, g = feature['properties'], feature['geometry']
        assert g['type'] in ('LineString', 'MultiLineString')
        # Keep provider translations and ranks; do not infer names or waterways from elevation.
        props = {key: p[key] for key in ('name', 'name_en', 'name_zh', 'min_zoom', 'min_label', 'scalerank', 'featurecla') if p.get(key) is not None}
        features.append({'type': 'Feature', 'id': p['ne_id'], 'properties': props, 'geometry': {'type': g['type'], 'coordinates': rounded(g['coordinates'])}})
    encoded = json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False, separators=(',', ':')).encode()
    OUTPUT.write_bytes(encoded)
    print(f'upstream sha256={hashlib.sha256(raw).hexdigest()}')
    print(f'{len(features)} river segments; {len(encoded):,} bytes / {len(gzip.compress(encoded)):,} gzip')


if __name__ == '__main__':
    main()
