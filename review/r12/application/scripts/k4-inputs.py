"""Read-only binding of the pinned binary kit and separately pinned application layer."""
import hashlib
import importlib.util
import json
import pathlib


def validate_inputs(kit, review, root):
    kit, review, root = [pathlib.Path(p).resolve(strict=True) for p in (kit, review, root)]
    record = json.loads((root / 'docs/release/V1_ENGINEERING_BUILD.json').read_bytes())
    spec = importlib.util.spec_from_file_location('kit_builder', root / 'scripts/build-v1-engineering-kit.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    builder.verify_manifest(kit, record['kitManifestSha256'])
    layer = record['applicationLayer']
    raw = builder.read_file(review / 'REVIEW_MANIFEST.json')
    if hashlib.sha256(raw).hexdigest() != layer['manifestSha256']:
        raise ValueError('APPLICATION_LAYER_PIN_MISMATCH')
    data = json.loads(raw)
    if data['version'] != 'BAARNE_ISOLATED_REVIEW_MANIFEST_V1':
        raise ValueError('INVALID_APPLICATION_REVIEW_FORMAT')
    paths = set()
    for file in review.rglob('*'):
        if file.is_symlink() or getattr(file, 'is_junction', lambda: False)():
            raise ValueError('APPLICATION_LAYER_LINK')
        if file.is_file():
            paths.add(file.relative_to(review).as_posix())
    if paths != set(data['files']) | {'REVIEW_MANIFEST.json'}:
        raise ValueError('APPLICATION_LAYER_FILE_SET_MISMATCH')
    for name, entry in data['files'].items():
        builder.relative_path(name)
        content = builder.read_file(review / name)
        if len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
            raise ValueError('APPLICATION_LAYER_FILE_CHANGED')
    return {'kit': kit, 'record': record, 'app': review / 'experiments/cometbft-fee-free-lab'}
