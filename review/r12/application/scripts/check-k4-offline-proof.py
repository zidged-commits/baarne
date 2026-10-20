"""Prepare public-only lab proof and run cryptographic adversarial checks offline.
Never opens a key/validator-state file; only the explicit public blockstore is copied.
"""
import argparse
import importlib.util
import base64
import copy
import hashlib
import json
import pathlib
import shutil
import subprocess
import uuid


def main():
    p = argparse.ArgumentParser()
    for name in ['verifier', 'evidence', 'genesis', 'blockstore', 'work-dir', 'image', 'output']:
        p.add_argument('--' + name, required=True)
    p.add_argument('--membership-application')
    p.add_argument('--kit',required=True)
    p.add_argument('--application-review',required=True)
    p.add_argument('--require-enrollment', action='store_true')
    p.add_argument('--lifecycle-v3', action='store_true')
    a = p.parse_args()
    kit=pathlib.Path(a.kit).resolve(strict=True)
    root=pathlib.Path(__file__).resolve().parent.parent
    spec=importlib.util.spec_from_file_location('k4_inputs',root/'scripts/k4-inputs.py')
    inputs=importlib.util.module_from_spec(spec);spec.loader.exec_module(inputs)
    validated=inputs.validate_inputs(kit,a.application_review,root)
    if pathlib.Path(a.verifier).resolve()!=(kit/'bin/verifier').resolve():raise ValueError('Selected kit verifier required')
    if pathlib.Path(a.membership_application).resolve()!=validated['app'].resolve():raise ValueError('Selected application layer required')

    application = pathlib.Path(a.membership_application).resolve(strict=True) if a.membership_application else None
    verifier, evidence, genesis, blockstore = [pathlib.Path(v).resolve(strict=True) for v in
                                               [a.verifier, a.evidence, a.genesis, a.blockstore]]
    work, output = pathlib.Path(a.work_dir).resolve(), pathlib.Path(a.output).resolve()
    if work.exists() or output.exists() or not a.image.startswith('sha256:'):
        raise ValueError('New output/work and pinned existing runtime required')
    if blockstore.name != 'blockstore.db' or any(f.is_symlink() for f in blockstore.rglob('*')):
        raise ValueError('Explicit ordinary public blockstore required')
    work.mkdir(parents=True)
    database = work / 'public-db'; database.mkdir()
    shutil.copytree(blockstore, database / 'blockstore.db')
    shutil.copyfile(genesis, work / 'genesis.json')
    pin = hashlib.sha256(genesis.read_bytes()).hexdigest()
    (work / 'genesis-sha256.txt').write_text(pin + '\n', encoding='ascii')
    record = json.loads(evidence.read_text(encoding='utf-8'))
    if a.lifecycle_v3:
        if not application or record['status'] != 'PASSED' or record.get('profile') != 'V3_RECONSTRUCTED_RESULTS_REQUIRE_CERTIFICATE_VERIFICATION' or record['genesis']['config']['domain'] != 'BAARNE_SYNTHETIC_LIFECYCLE_V3':
            raise ValueError('Explicit V3 profile required')
    elif record['status'] != 'ABCI_APPLICATION_INTEGRATION_PASS':
        raise ValueError('Expected successful historical integration record')
    packet = {key: record[key] for key in ['blocks', 'blockResults', 'genesis', 'replay']}
    if a.require_enrollment:
        if not application or 'enrollments' not in record:
            raise ValueError('Membership mode and public enrollment material required')
        packet['enrollments'] = record['enrollments']
    last = packet['blocks'][-1]['block']['header']['height']
    label = 'offline-' + uuid.uuid4().hex
    run_names = []
    checks = []
    result = {'status': 'OFFLINE_LAB_PROOF_FAILED', 'livePilotAuthorized': False,
              'freshnessProven': False, 'checks': checks, 'genesisSha256': pin,
              'verifierSha256': hashlib.sha256(verifier.read_bytes()).hexdigest()}

    def run(args, write_database=False, node=False):
        name = 'baarne-proof-' + uuid.uuid4().hex[:12]; run_names.append(name)
        command = ['docker', 'run', '--name', name, '--label', 'baarne.proof=' + label,
                   '--network', 'none', '--cpus', '1', '--memory', '256m', '--cap-drop', 'ALL',
                   '--security-opt', 'no-new-privileges', '--mount',
                   'type=bind,source=' + str(verifier) + ',target=/verify,readonly',
                   '--mount', 'type=bind,source=' + str(work) + ',target=/proof' + ('' if write_database else ',readonly'),
                   *(['--mount', 'type=bind,source=' + str(application) + ',target=/app,readonly',
                      '--mount', 'type=bind,source=' + str(application.parent.parent / 'packages') + ',target=/packages,readonly',
                      '--mount', 'type=bind,source=' + str(application.parent.parent / 'node_modules') + ',target=/node_modules,readonly',
                      '-e', 'NODE_OPTIONS=--experimental-strip-types'] if application else []),
                   '--mount','type=bind,source='+str(kit/'runtime/linux-x64')+',target=/runtime,readonly',
                   '-e','PATH=/runtime:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                   a.image, *(['node', '/app/membership-offline.mjs'] if node else ['/verify']), *args]
        return subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=30)

    def verify(value, name, positive=False, custom_pin=None, semantic_change=None):
        path = work / (name + '.json')
        with path.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, separators=(',', ':'), ensure_ascii=False)
        extra = []
        if application:
            semantic_name = name + '.semantic.json'
            replay = run(['/proof/' + path.name, '/proof/' + semantic_name,
                          *(['--require-enrollment'] if a.require_enrollment else [])], True, True)
            if replay.returncode:
                if positive:
                    raise RuntimeError('Semantic replay failed: ' + replay.stderr)
                checks.append({'case': name, 'rejected': True, 'stage': 'membership_replay', 'reason': replay.stderr[-600:]})
                return
            if semantic_change:
                semantic_path = work / semantic_name
                semantic = json.loads(semantic_path.read_text(encoding='utf-8'))
                semantic_change(semantic)
                semantic_path.write_text(json.dumps(semantic), encoding='utf-8')
            extra = ['--membership-replay', '/proof/' + semantic_name]
        execution = run(['--packet' , '/proof/' + path.name, '--genesis', '/proof/genesis.json',
                         '--genesis-sha256', custom_pin or pin, *extra])
        if positive:
            if execution.returncode:
                raise RuntimeError('Valid proof rejected: ' + execution.stderr)
            return json.loads(execution.stdout)
        if execution.returncode == 0:
            raise RuntimeError('Tampering accepted: ' + name)
        checks.append({'case': name, 'rejected': True, 'reason': execution.stderr.strip()[:600]})

    def changed(change):
        value = copy.deepcopy(packet); change(value); return value

    try:
        exported = run(['--export-db', '/proof/public-db', '--export-height', str(last)], True)
        if exported.returncode:
            raise RuntimeError('Public commit export failed: ' + exported.stderr)
        packet['terminalCommit'] = json.loads(exported.stdout)
        result['verified'] = verify(packet, 'public-proof', True)
        checks.append({'case': 'valid_offline_packet', 'passed': True})
        if a.require_enrollment:
            verify(changed(lambda x: x.pop('enrollments')), 'missing_required_enrollment')
            verify(changed(lambda x: x['enrollments'][0].__setitem__('legacySignature', '0x' + '00' * 65)), 'forged_enrollment_owner')
            verify(changed(lambda x: x['enrollments'][0].__setitem__('recoverySignature', '00' * 64)), 'forged_recovery_possession')
            result['enrollmentRequiredAndChecked'] = True
        verify(packet, 'wrong_external_genesis_pin', custom_pin='00' * 32)
        verify(changed(lambda x: x.pop('terminalCommit')), 'missing_terminal_commit')
        verify(changed(lambda x: x['blocks'].pop(1)), 'missing_interior_block')
        verify(changed(lambda x: x['blocks'].reverse()), 'reordered_blocks')
        verify(changed(lambda x: x['blocks'][2]['block']['header'].__setitem__('chain_id', 'OTHER_CHAIN')), 'wrong_chain')
        verify(changed(lambda x: x['blocks'][2]['block']['header'].__setitem__('validators_hash', '00' * 32)), 'substituted_validator_set')
        verify(changed(lambda x: x['blocks'][2]['block']['header']['last_block_id'].__setitem__('hash', '00' * 32)), 'wrong_parent')
        verify(changed(lambda x: x['blocks'][2]['block_id']['parts'].__setitem__('total', 999)), 'wrong_part_set')
        verify(changed(lambda x: x['terminalCommit'].__setitem__('height', '1')), 'wrong_commit_height')
        signed = next(i for i, sig in enumerate(packet['terminalCommit']['signatures']) if sig.get('signature'))
        verify(changed(lambda x: x['terminalCommit']['signatures'][signed].__setitem__('signature', base64.b64encode(b'\0' * 64).decode())), 'forged_commit_signature')
        def absent_quorum(x):
            present = [s for s in x['terminalCommit']['signatures'] if s.get('signature')]
            for signature in present[2:]:
                signature.update({'block_id_flag': 1, 'validator_address': '',
                                  'timestamp': '0001-01-01T00:00:00Z', 'signature': None})
        verify(changed(absent_quorum), 'insufficient_commit_quorum')
        tx_block = next(i for i, b in enumerate(packet['blocks'][:-1]) if b['block']['data'].get('txs'))
        verify(changed(lambda x: x['blocks'][tx_block]['block']['data']['txs'].__setitem__(0, base64.b64encode(b'altered').decode())), 'changed_transaction_bytes')
        verify(changed(lambda x: x['blockResults'][tx_block]['txs_results'][0].__setitem__('code', 88)), 'changed_execution_result')
        verify(changed(lambda x: x['blockResults'][2].__setitem__('app_hash', base64.b64encode(b'\0' * 32).decode())), 'changed_app_result_hash')
        verify(changed(lambda x: x['replay']['state'].__setitem__('accepted', [])), 'changed_replay_state')
        verify(changed(lambda x: x['replay']['info'].__setitem__('acceptedCount', 90)), 'changed_replay_count')
        verify(changed(lambda x: x['replay']['hashes'].__setitem__(0, '00' * 32)), 'changed_replay_hash')
        if application:
            if a.lifecycle_v3:
                verify(changed(lambda x: x['genesis']['bootstrap'][0].__setitem__('legacySignature', '0x' + '00' * 65)), 'forged_bootstrap_owner')
                verify(changed(lambda x: x['genesis']['bootstrap'][0].__setitem__('recoverySignature', '00' * 64)), 'forged_bootstrap_recovery_possession')
                verify(changed(lambda x: x['genesis']['config']['membership'].__setitem__('networkId', 'baarne:foreign-network')), 'changed_application_genesis')
            else:
                signer = next(iter(packet['genesis']['signers']))
                verify(changed(lambda x: x['genesis']['signers'].__setitem__(signer, '00' * 32)), 'changed_application_genesis')
            verify(packet, 'changed_semantic_result', semantic_change=lambda x: x['results'][tx_block][0].__setitem__('code', 1))
            verify(packet, 'changed_semantic_initial_state', semantic_change=lambda x: x['initialState'].__setitem__('height', 99))
            verify(packet, 'changed_semantic_hash', semantic_change=lambda x: x['hashes'].__setitem__(0, '00' * 32))
            verify(packet, 'changed_semantic_final_state', semantic_change=lambda x: x['state'].__setitem__('accepted', []))
        else:
            verify(changed(lambda x: x['genesis']['slots'].__setitem__('lab-slot-a', '00' * 32)), 'changed_application_genesis')
        # Nondeterministic logs are not part of consensus result hashing. Keep
        # this honest by proving they are excluded rather than claiming coverage.
        informational = changed(lambda x: x['blockResults'][tx_block]['txs_results'][0].__setitem__('log', 'unauthenticated diagnostic text'))
        verify(informational, 'nondeterministic_log_not_consensus_authenticated', True)
        checks.append({'case': 'nondeterministic_log_not_consensus_authenticated', 'acceptedAsInformationalOnly': True})
        result['executionVerification'] = 'GO_CONSENSUS_PLUS_NODE_MEMBERSHIP_REPLAY' if application else 'INDEPENDENT_GO_SLOT_REPLAY'
        result['status'] = 'OFFLINE_LAB_PROOF_TESTS_PASS'
    except Exception as exc:
        result['error'] = str(exc)
    finally:
        errors = []
        for name in run_names:
            try:
                inspect = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True, timeout=10, check=True)
                value = json.loads(inspect.stdout)[0]
                if value['Config']['Labels'].get('baarne.proof') != label or value['State']['Running']:
                    raise ValueError('Ownership/state mismatch')
                subprocess.run(['docker', 'rm', name], capture_output=True, timeout=10, check=True)
            except Exception as exc:
                errors.append({'name': name, 'error': str(exc)})
        result['cleanup'] = {'completed': not errors, 'errors': errors}
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8') as stream:
            json.dump(result, stream, indent=2); stream.write('\n')
        print(json.dumps(result, indent=2))
    if result['status'] != 'OFFLINE_LAB_PROOF_TESTS_PASS' or not result['cleanup']['completed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
