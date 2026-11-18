"""Upload immutable packs, then publish the readiness manifest. Run from worker/ after wrangler whoami."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
manifest = json.loads((root / 'manifest.json').read_text())


def upload(part):
    path = root / part['file']
    with path.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == part['sha256']
    command = ['npx', 'wrangler', 'r2', 'object', 'put', f'reader-books/{part["key"]}', '--file', str(path), '--remote']
    result = subprocess.run(command, capture_output=True, text=True)
    (root / f'{part["file"]}.upload.log').write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f'Upload failed: {part["file"]}; see local upload log')
    print(f'Uploaded {part["file"]}: {part["bytes"]:,} bytes', flush=True)


with ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(upload, manifest['objects']))
# Clients must never observe readiness while any pack upload is incomplete.
subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', f'reader-books/{manifest["key"]}', '--file', str(root / 'manifest.json'), '--remote'], check=True)
print(f'Published {manifest["key"]}', flush=True)
