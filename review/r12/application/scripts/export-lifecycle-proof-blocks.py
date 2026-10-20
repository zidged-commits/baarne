"""Complete proof tail from an explicit public blockstore COPY, never validator keys."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess


def main():
    p = argparse.ArgumentParser()
    for name in ('blockstore', 'input', 'verifier', 'image', 'output-dir'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--height', type=int, required=True)
    a = p.parse_args()
    source = pathlib.Path(a.blockstore).resolve(strict=True)
    target = pathlib.Path(a.output_dir).resolve()
    if source.name != 'blockstore.db' or target.exists() or not 2 <= a.height <= 1001 or not a.image.startswith('sha256:'):
        raise ValueError('Explicit public DB, fresh output and bounded height required')
    if any(f.is_symlink() for f in source.rglob('*')):
        raise ValueError('No symbolic links')
    before = {str(f.relative_to(source)): hashlib.sha256(f.read_bytes()).hexdigest() for f in source.rglob('*') if f.is_file()}
    target.mkdir(parents=True)
    copied = target / 'public-db'
    copied.mkdir()
    shutil.copytree(source, copied / 'blockstore.db')
    shutil.copyfile(pathlib.Path(a.input).resolve(strict=True), target / 'public-input.json')
    command = ['docker', 'run', '--rm', '--network', 'none', '--cpus', '1', '--memory', '256m', '--cap-drop', 'ALL',
               '--mount', 'type=bind,source=' + str(pathlib.Path(a.verifier).resolve(strict=True)) + ',target=/verify,readonly',
               '--mount', 'type=bind,source=' + str(copied) + ',target=/proof', a.image,
               '/verify', '--export-db', '/proof', '--export-height', str(a.height), '--export-blocks']
    r = subprocess.run(command, text=True, encoding='utf-8', capture_output=True, timeout=30, check=True)
    blocks = json.loads(r.stdout)
    if len(blocks) != a.height:
        raise ValueError('Incomplete export')
    (target / 'public-blocks.json').write_text(json.dumps(blocks), encoding='utf-8')
    after = {str(f.relative_to(source)): hashlib.sha256(f.read_bytes()).hexdigest() for f in source.rglob('*') if f.is_file()}
    if before != after:
        raise ValueError('Public source changed')
    (target / 'EXPORT_RESULT.json').write_text(json.dumps({'height': a.height, 'sourceUnchanged': True, 'publicSourceHashes': before}), encoding='utf-8')


if __name__ == '__main__':
    main()
