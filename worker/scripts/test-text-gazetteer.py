"""Small end-to-end source-format test; no production data or cloud access."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-text-gazetteer.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class GlobalGazetteerTest(unittest.TestCase):
    def test_multilingual_names_country_partition_and_history(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            def row(ident, name, country):
                return '\t'.join([ident, name, name, '', '48.85', '2.35', 'P', 'PPL', country, '', '11', '', '', '', '0', '', '', '', '2026-07-03'])
            with ZipFile(root / 'places.zip', 'w') as z:
                z.writestr('allCountries.txt', row('2988507', 'Paris', 'FR') + '\n' + row('4717560', 'Paris', 'US') + '\n')
            with ZipFile(root / 'aliases.zip', 'w') as z:
                z.writestr('alternateNamesV2.txt', '\n'.join([
                    '1\t2988507\tzh\t巴黎\t1\t\t\t\t\t',
                    '2\t2988507\tja\tパリ\t\t\t\t\t\t',
                    '3\t2988507\tru\tПариж\t\t\t\t\t\t',
                    '4\t2988507\tfr\tLutèce\t\t\t\t1\t-52\t360',
                    '5\t2988507\tlink\thttps://example.test\t\t\t\t\t\t',
                    '6\t2988507\tpost\t75001\t\t\t\t\t\t',
                    '7\t9999999\tzh\t不存在\t\t\t\t\t\t',
                ]) + '\n')
            out = root / 'out'
            m = builder.build(root / 'places.zip', root / 'aliases.zip', out, root / 'manifest.json')
            def lookup(name, country):
                key = country + ':' + builder.normalize(name)
                shard = int(hashlib.sha256(key.encode()).hexdigest()[:3], 16)
                offset, length, raw_length = m['ranges'][shard]
                with (out / m['objects'][shard >> 8]['file']).open('rb') as f:
                    f.seek(offset); raw = gzip.decompress(f.read(length))
                self.assertEqual(len(raw), raw_length)
                return json.loads(raw).get(key, [])
            for name in ['Paris', '巴黎', 'パリ', 'Париж']:
                self.assertEqual(lookup(name, 'FR')[0][0], '2988507')
            self.assertEqual(lookup('Paris', 'US')[0][0], '4717560')
            self.assertEqual(lookup('Lutèce', 'FR')[0][9], [['fr', True, '-52', '360']])
            self.assertEqual(lookup('75001', 'FR'), [])
            self.assertEqual(m['orphanAliases'], 1)
            self.assertEqual(m['importedAliasRows'], 4)
            self.assertEqual(m['skippedNonNames'], 2)
            self.assertEqual(builder.normalize('İSTÂNBUL'), 'istanbul')
            self.assertEqual(builder.normalize('ΛΕΣΒΟΣ'), 'λεσβος')
            self.assertEqual(builder.normalize('ΟΣ-Α'), 'οςα')


if __name__ == '__main__':
    unittest.main()
