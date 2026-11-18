"""Verify real packed artifacts and representative multilingual lookups before upload."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-text-gazetteer.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
root = Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_text())
for part in manifest['objects']:
    path = root / part['file']
    assert path.stat().st_size == part['bytes']
    assert builder.fingerprint(path) == part['sha256']


def lookup(name, country):
    key = country + ':' + builder.normalize(name)
    shard = int(hashlib.sha256(key.encode()).hexdigest()[:3], 16)
    offset, length, raw_length = manifest['ranges'][shard]
    part = manifest['objects'][shard >> 8]
    with (root / part['file']).open('rb') as stream:
        stream.seek(offset)
        raw = gzip.decompress(stream.read(length))
    assert len(raw) == raw_length
    rows = json.loads(raw).get(key, [])
    assert all(r[8] == country for r in rows)
    return rows


samples = [('平型关', 'CN', '1798648'), ('巴黎', 'FR', '2988507'), ('パリ', 'FR', '2988507'),
           ('Париж', 'FR', '2988507'), ('伦敦', 'GB', '2643743'), ('富士山', 'JP', '1864094'),
           ('Leningrad', 'RU', '498817'), ('Waterloo', 'BE', '2783985'), ('Thames', 'GB', '2636063'),
           ('Mont Blanc', 'FR', '3181986'), ('Mont Blanc', 'IT', '3181986')]
for name, country, ident in samples:
    rows = lookup(name, country)
    assert any(r[0] == ident for r in rows), (name, country, rows)
    print(json.dumps({'name': name, 'country': country, 'candidates': len(rows), 'expectedId': ident}, ensure_ascii=False))
assert all(r[0] != '2988507' for r in lookup('Paris', 'US'))
print(f"Verified {len(manifest['objects'])} pack hashes and {len(samples) + 1} real lookups")
