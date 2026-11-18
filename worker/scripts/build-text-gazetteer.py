"""Build a bounded-memory global GeoNames name index (CC BY 4.0).

Usage: python3 scripts/build-text-gazetteer.py allCountries.zip alternateNamesV2.zip output-dir
Raw sources are read-only. Temporary partitions live inside output-dir and are removed.
16 range-readable packs contain 4096 independently gzipped name shards.
"""
import argparse
from collections import Counter
from contextlib import ExitStack
import gzip
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unicodedata
import zipfile

PARTITIONS = 128
SHARDS = 4096
PACKS = 16
NON_NAMES = {'link', 'post', 'iata', 'icao', 'faac', 'wkdt', 'unlc', 'phon'}


def normalize(value):
    # Match JavaScript: strip combining marks, lowercase the whole string, then strip separators.
    value = ''.join(c for c in unicodedata.normalize('NFKD', value) if unicodedata.category(c)[0] != 'M').lower()
    return ''.join(c for c in value if unicodedata.category(c)[0] in ('L', 'N'))


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def fingerprint(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def partition(source, member, target, prefix, id_column):
    count = 0
    with ExitStack() as stack:
        streams = [stack.enter_context((target / f'{prefix}-{i}.txt').open('wb')) for i in range(PARTITIONS)]
        archive = stack.enter_context(zipfile.ZipFile(source))
        stream = stack.enter_context(archive.open(member))
        for line in stream:
            ident = int(line.split(b'\t', id_column + 1)[id_column])
            streams[ident % PARTITIONS].write(line)
            count += 1
            if count % 2_000_000 == 0:
                print(f'{prefix}: {count:,} rows partitioned', flush=True)
    return count


def build(source, alternates, output, manifest_path):
    output.mkdir(parents=True, exist_ok=False)
    countries, languages = Counter(), Counter()
    alias_rows = skipped_aliases = orphan_aliases = indexed_names = 0
    with tempfile.TemporaryDirectory(prefix='build-', dir=output) as work:
        work = Path(work)
        records = partition(source, 'allCountries.txt', work, 'places', 0)
        alternate_rows = partition(alternates, 'alternateNamesV2.txt', work, 'aliases', 1)
        with ExitStack() as stack:
            buckets = [stack.enter_context((work / f'names-{i}.jsonl').open('w')) for i in range(PARTITIONS)]
            for part in range(PARTITIONS):
                places = {}
                with (work / f'places-{part}.txt').open() as stream:
                    for line in stream:
                        r = line.rstrip('\n').split('\t')
                        codes = sorted({c for c in [r[8], *r[9].split(',')] if re.fullmatch('[A-Z]{2}', c)})
                        # Preserve every feature, including those with no country code.
                        if not codes:
                            codes = ['']
                        countries.update(codes)
                        names = {n: set() for n in {r[1], r[2], *r[3].split(',')} if n}
                        # Country code at index 8 is the lookup jurisdiction, set at emission.
                        record = [r[0], r[1], float(r[5]), float(r[4]), r[6], r[7], r[10], r[11], '']
                        places[int(r[0])] = (record, codes, names)
                with (work / f'aliases-{part}.txt').open() as stream:
                    for line in stream:
                        r = line.rstrip('\n').split('\t'); r += [''] * max(0, 10 - len(r))
                        lang, name = r[2], r[3]
                        if lang in NON_NAMES or not name or '://' in name:
                            skipped_aliases += 1
                            continue
                        entry = places.get(int(r[1]))
                        if entry is None:
                            orphan_aliases += 1
                            continue
                        # Language and historical validity are retained per name match.
                        entry[2].setdefault(name, set()).add((lang, r[7] == '1', r[8], r[9]))
                        alias_rows += 1
                        languages[lang or 'und'] += 1
                for record, codes, names in places.values():
                    normalized = {}
                    for name, metadata in names.items():
                        key = normalize(name)
                        if key and '://' not in name:
                            normalized.setdefault(key, set()).update(metadata)
                    for country in codes:
                        record[8] = country
                        for name, metadata in normalized.items():
                            key = country + ':' + name
                            shard = int.from_bytes(hashlib.sha256(key.encode()).digest()[:2], 'big') >> 4
                            buckets[shard >> 5].write(encode([shard, key, record, sorted(metadata)]) + '\n')
                            indexed_names += 1
                if (part + 1) % 8 == 0:
                    print(f'Joined {part + 1}/{PARTITIONS} partitions; {indexed_names:,} name references', flush=True)
        ranges, parts = [], []
        largest_raw = largest_gzip = 0
        with ExitStack() as stack:
            packs = [stack.enter_context((output / f'pack-{i:02x}.bin').open('wb')) for i in range(PACKS)]
            for part in range(PARTITIONS):
                shards = [{} for _ in range(32)]
                with (work / f'names-{part}.jsonl').open() as stream:
                    for line in stream:
                        shard, key, record, metadata = json.loads(line)
                        shards[shard % 32].setdefault(key, []).append([*record, metadata])
                for inner, shard in enumerate(shards):
                    # Sort records and keys to make artifact identity reproducible.
                    for matches in shard.values():
                        matches.sort(key=lambda r: int(r[0]))
                    raw = encode(dict(sorted(shard.items()))).encode()
                    payload = gzip.compress(raw, compresslevel=6, mtime=0)
                    if len(raw) > 4 * 1024 * 1024:
                        raise ValueError('Shard exceeds Worker memory budget; increase SHARDS')
                    pack = packs[(part * 32 + inner) >> 8]
                    ranges.append([pack.tell(), len(payload), len(raw)])
                    pack.write(payload)
                    largest_raw = max(largest_raw, len(raw)); largest_gzip = max(largest_gzip, len(payload))
                if (part + 1) % 16 == 0:
                    print(f'Packed {part + 1}/{PARTITIONS} name partitions', flush=True)
    for i in range(PACKS):
        path = output / f'pack-{i:02x}.bin'
        parts.append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': fingerprint(path)})
    digest = hashlib.sha256(encode(parts).encode()).hexdigest()
    prefix = f'gazetteer/world-{digest[:16]}'
    manifest = dict(format=2, key=f'{prefix}/manifest.json', sha256=digest, shards=SHARDS,
                    sources={'allCountries': fingerprint(source), 'alternateNamesV2': fingerprint(alternates)},
                    records=records, alternateRows=alternate_rows, importedAliasRows=alias_rows,
                    skippedNonNames=skipped_aliases, orphanAliases=orphan_aliases,
                    nameReferences=indexed_names, countries=dict(sorted(countries.items())), languages=dict(sorted(languages.items())),
                    largestRawShard=largest_raw, largestCompressedShard=largest_gzip,
                    objects=[{**p, 'key': f'{prefix}/{p["file"]}'} for p in parts], ranges=ranges)
    data = encode(manifest) + '\n'
    (output / 'manifest.json').write_text(data)
    manifest_path.write_text(data)
    print(encode({k: v for k, v in manifest.items() if k not in ('ranges', 'countries', 'languages', 'objects')}), flush=True)
    print(f'Total bytes: {sum(p["bytes"] for p in parts):,}; languages: {len(languages)}; countries: {len(countries)}', flush=True)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('alternates', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).resolve().parents[1] / 'src/atlas/data/text-gazetteer.json')
    args = parser.parse_args()
    build(args.source, args.alternates, args.output, args.manifest)
