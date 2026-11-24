"""Generate reversible character pairs from the OpenCC 1.4.2 dictionaries."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path


def read_dictionary(path, digest):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Expected the OpenCC 1.4.2 version of {path.name}")
    rows = {}
    for line in data.decode("utf-8").splitlines():
        if line and not line.startswith("#"):
            key, values = line.split("\t")
            rows[key] = values.split()
    return rows


def build(directory):
    st = read_dictionary(directory / "STCharacters.txt", "a0ca1601c70648cf48b33c3c6210ccbecc5c7eead4b4c3daf76587ba2c03582b")
    ts = read_dictionary(directory / "TSCharacters.txt", "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925")
    neighbors = defaultdict(set)
    for table in (st, ts):
        for key, values in table.items():
            for value in values:
                if key != value:
                    neighbors[key].add(value)
                    neighbors[value].add(key)

    pairs = []
    for simple, values in sorted(st.items()):
        traditional = values[0]
        if (len(simple) == len(traditional) == 1 and values == [traditional]
                and ts.get(traditional) == [simple]
                and neighbors[simple] == {traditional} and neighbors[traditional] == {simple}):
            pairs.append(simple + traditional)
    return pairs


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dictionary_dir", type=Path, help="OpenCC data/dictionary directory")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    pairs = build(args.dictionary_dir)
    lines = [json.dumps(pairs[i:i + 16], ensure_ascii=False)[1:-1] for i in range(0, len(pairs), 16)]
    args.output.write_text("[\n  " + ",\n  ".join(lines) + "\n]\n", encoding="utf-8")
