"""K4 one-survivor certified-history replay using the selected existing verifiers."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser()
    for name in ['kit', 'application-review', 'proof-directory', 'work-dir', 'output']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    modules = {}
    for key, name in [('inputs', 'k4-inputs.py'), ('restore', 'restore-certified-lifecycle-packet.py')]:
        spec = importlib.util.spec_from_file_location(key, root / 'scripts' / name)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules[key] = module
    inputs = modules['inputs'].validate_inputs(args.kit, args.application_review, root)
    kit, app = inputs['kit'], inputs['app']
    source = pathlib.Path(args.proof_directory).resolve(strict=True)
    work, output = pathlib.Path(args.work_dir).resolve(), pathlib.Path(args.output).resolve()
    if work.exists() or output.exists():
        raise ValueError('NEW_ARCHIVE_WORK_REQUIRED')
    packet = (source / 'public-proof.json').read_bytes()
    genesis = (source / 'genesis.json').read_bytes()
    packet_pin = hashlib.sha256(packet).hexdigest()
    genesis_pin = hashlib.sha256(genesis).hexdigest()
    expected = json.loads(packet)['replay']['info']
    work.mkdir(parents=True)
    archives = [work / ('archive-' + str(i)) for i in range(3)]
    for directory in archives:
        directory.mkdir()
        (directory / 'public-proof.json').write_bytes(packet)
        (directory / 'genesis.json').write_bytes(genesis)
    # Only generated public copies under this exact work directory are removed.
    for directory in archives[:2]:
        for name in ['public-proof.json', 'genesis.json']:
            target = directory / name
            assert target.resolve().is_relative_to(work)
            target.unlink()
    restored = work / 'restored'
    restore_result = modules['restore'].restore(archives, packet_pin, restored)
    assert restore_result['sourceArchiveIndex'] == 2
    # Genesis is independently pinned. A packet hash cannot establish its authority.
    source_genesis = archives[2] / 'genesis.json'
    if hashlib.sha256(source_genesis.read_bytes()).hexdigest() != genesis_pin:
        raise ValueError('GENESIS_ANCHOR_MISMATCH')
    shutil.copyfile(source_genesis, restored / 'genesis.json')
    steps = []

    def run(label, command, semantic=False):
        name = 'baarne-k4-archive-' + uuid.uuid4().hex[:12]
        args = ['docker', 'run', '--rm', '--pull=never', '--name', name,
                '--label', 'baarne.task=k4-certified-archive', '--network', 'none',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--mount', f'type=bind,source={kit / "bin/verifier"},target=/verify,readonly',
                '--mount', f'type=bind,source={restored},target=/proof' + ('' if semantic else ',readonly'),
                '--mount', f'type=bind,source={app},target=/app,readonly',
                '--mount', f'type=bind,source={app.parent.parent / "packages"},target=/packages,readonly',
                '--mount', f'type=bind,source={app.parent.parent / "node_modules"},target=/node_modules,readonly',
                '--mount', f'type=bind,source={kit / "runtime/linux-x64"},target=/runtime,readonly',
                'sha256:3b4a11519ad929d1e1d261a12cff056f0c85b735253d7d861346b9c6f8b36437', *command]
        try:
            process = subprocess.run(args, capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=15)
            raise
        (work / (label + '.stdout')).write_bytes(process.stdout)
        (work / (label + '.stderr')).write_bytes(process.stderr)
        steps.append({'step': label, 'network': 'none', 'exitCode': process.returncode})
        if process.returncode:
            raise RuntimeError(label + ' failed; retain logs')
        return process.stdout

    run('fresh-semantic-replay', ['/runtime/node', '/app/membership-offline.mjs',
                                 '/proof/public-proof.json', '/proof/semantic.json'], True)
    verified = json.loads(run('certificate', ['/verify', '--packet', '/proof/public-proof.json',
        '--genesis', '/proof/genesis.json', '--genesis-sha256', genesis_pin,
        '--membership-replay', '/proof/semantic.json']))
    assert verified['stateHash'] == expected['stateHash']
    assert verified['acceptedCount'] == expected['acceptedCount']
    assert not verified['livePilotAuthorized'] and not verified['freshnessProven']
    checks = [{'check': 'one_surviving_archive_full_certificate_and_semantic_replay', 'passed': True}]
    (archives[0] / 'public-proof.json').write_bytes(b'corrupt')
    fallback = modules['restore'].restore(archives, packet_pin, work / 'fallback')
    assert fallback['sourceArchiveIndex'] == 2
    checks.append({'check': 'corrupt_replica_rejected_pinned_survivor_used', 'passed': True})
    for case, pin in [('wrong-pin', '0' * 64), ('all-unavailable', packet_pin)]:
        if case == 'all-unavailable':
            for name in ['public-proof.json', 'genesis.json']:
                (archives[2] / name).unlink()
        try:
            modules['restore'].restore(archives, pin, work / case)
        except ValueError as error:
            assert str(error) == 'ARCHIVE_UNAVAILABLE_OR_INVALID'
            assert not (work / case).exists()
        else:
            raise AssertionError('Unavailable or wrong-pin history accepted')
        checks.append({'check': case, 'passed': True})
    result = {'version': 'BAARNE_K4_ARCHIVE_REPLAY_V1', 'status': 'PASSED', 'checks': checks,
              'packetSha256': packet_pin, 'genesisSha256': genesis_pin,
              'steps': steps, 'verified': verified, 'independentArchives': False,
              'productionAuthorized': False, 'pilot': 'NO-GO'}
    with output.open('x', encoding='utf8') as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({'status': 'PASSED', 'checks': len(checks)}))


if __name__ == '__main__':
    main()
