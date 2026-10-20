"""V3 synthetic four-process integration. Internal Docker network, no published ports.
Reuses approved pinned artifacts. Evidence contains public records only.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import subprocess
import time
import uuid
from datetime import datetime


def main():
    parser = argparse.ArgumentParser()
    for field in ('binary', 'bridge', 'application', 'work-dir', 'image', 'output'):
        parser.add_argument('--' + field, required=True)
    a = parser.parse_args()
    binary, bridge, app = [pathlib.Path(x).resolve(strict=True) for x in (a.binary, a.bridge, a.application)]
    work, output = pathlib.Path(a.work_dir).resolve(), pathlib.Path(a.output).resolve()
    if work.exists() or output.exists() or not a.image.startswith('sha256:'):
        raise ValueError('Fresh output/work and pinned existing image required')
    work.mkdir(parents=True)
    session = 'baarne-v3-' + uuid.uuid4().hex[:12]
    names = [session + '-node' + str(i) for i in range(4)]
    network = session + '-net'
    owned, network_created, signer, observer = [], False, None, None
    start = time.monotonic()
    sources = [pathlib.Path(__file__), *app.glob('*.mjs'), app / 'bridge.go']
    hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    result = {'status': 'INTERRUPTED', 'mode': 'FOUR_LOCAL_SYNTHETIC_VALIDATORS', 'livePilotAuthorized': False,
              'independentOperators': False, 'offlineCertificateVerified': False, 'checks': [], 'sourceHashes': hashes,
              'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
              'bridgeSha256': hashlib.sha256(bridge.read_bytes()).hexdigest(), 'runtimeImage': a.image}
    mounts = ['--mount', 'type=bind,source=' + str(binary) + ',target=/cometbft,readonly',
              '--mount', 'type=bind,source=' + str(bridge) + ',target=/bridge,readonly',
              '--mount', 'type=bind,source=' + str(app) + ',target=/app,readonly',
              '--mount', 'type=bind,source=' + str(app.parent.parent / 'packages') + ',target=/packages,readonly',
              '--mount', 'type=bind,source=' + str(app.parent.parent / 'node_modules') + ',target=/node_modules,readonly',
              '-e', 'NODE_OPTIONS=--experimental-strip-types']

    def docker(*args, timeout=30):
        r = subprocess.run(['docker', *args], text=True, encoding='utf-8', capture_output=True, timeout=timeout)
        if r.returncode:
            raise RuntimeError(r.stderr[-2000:])
        return r.stdout.strip()

    def exchange(process, q):
        process.stdin.write(json.dumps(q) + '\n')
        process.stdin.flush()
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('Fixture/observer exited')
        data = json.loads(line)
        if not data['ok']:
            raise RuntimeError(data['error'])
        return data.get('result', data)

    def rpc(i, method, params=None):
        return exchange(observer, {'node': i, 'method': method, 'params': params or {}})

    def wait(fn, seconds=45):
        deadline = min(start + 300, time.monotonic() + seconds)
        last = None
        while time.monotonic() < deadline:
            try:
                r = fn()
                if r:
                    return r
            except Exception as e:
                last = str(e)
            time.sleep(.3)
        raise TimeoutError('Condition not reached: ' + str(last))

    def query(i=0):
        response = rpc(i, 'abci_query', {'path': '/state'})['response']
        if response['code'] != 0:
            raise RuntimeError('Query failed')
        return json.loads(base64.b64decode(response['value']))

    def receipt(tx_hash):
        return rpc(0, 'tx', {'hash': base64.b64encode(bytes.fromhex(tx_hash)).decode()})

    def submit(command, expected_check=0):
        raw = exchange(signer, command)['tx']
        response = rpc(0, 'broadcast_tx_sync', {'tx': base64.b64encode(raw.encode()).decode()})
        assert response['code'] == expected_check, response
        if expected_check:
            return response
        proof = wait(lambda: receipt(response['hash']))
        assert proof['tx_result']['code'] == 0, proof
        return proof

    def at_height(height):
        block = rpc(0, 'block', {'height': str(height)})['block']
        return int(datetime.fromisoformat(block['header']['time'].replace('Z', '+00:00')).timestamp())

    try:
        setup = session + '-setup'; owned.append(setup)
        docker('run', '--name', setup, '--label', 'baarne.session=' + session, '--network', 'none', *mounts,
               '--mount', 'type=bind,source=' + str(work) + ',target=/work', a.image,
               '/cometbft', 'testnet', '--v', '4', '--o', '/work/nodes', '--hostname-prefix', session + '-node')
        generator = session + '-signer'; owned.append(generator)
        signer = subprocess.Popen(['docker', 'run', '-i', '--name', generator, '--label', 'baarne.session=' + session,
                                   '--network', 'none', *mounts, a.image, 'node', '/app/lifecycle-vectors.mjs', str(int(time.time()) - 60)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
        line = signer.stdout.readline()
        if not line:
            raise RuntimeError('Fixture generation failed')
        vectors = json.loads(line)
        public_input = {'config': vectors['config'], 'bootstrap': vectors['bootstrap']}
        (work / 'public-input.json').write_text(json.dumps(public_input), encoding='utf-8')
        for i, name in enumerate(names):
            home = work / 'nodes' / ('node' + str(i))
            (home / 'lab-genesis.json').write_text(json.dumps(public_input), encoding='utf-8')
            path = home / 'config/genesis.json'; genesis = json.loads(path.read_text(encoding='utf-8'))
            genesis['chain_id'] = 'BAARNE_FEE_FREE_FINALITY_LAB_V1'; genesis['app_state'] = public_input
            genesis['consensus_params']['block']['max_bytes'] = '262144'; genesis['consensus_params']['evidence']['max_bytes'] = '65536'
            path.write_text(json.dumps(genesis), encoding='utf-8')
            path = home / 'config/config.toml'; section = ''; lines = path.read_text(encoding='utf-8').splitlines()
            for index, line in enumerate(lines):
                if line.startswith('['): section = line
                if section == '[rpc]' and line.startswith('laddr ='): lines[index] = 'laddr = "tcp://0.0.0.0:26657"'
                elif line.startswith('allow_duplicate_ip ='): lines[index] = 'allow_duplicate_ip = true'
                elif line.startswith('pex ='): lines[index] = 'pex = false'
                elif line.startswith('timeout_commit ='): lines[index] = 'timeout_commit = "500ms"'
                elif line.startswith('log_level ='): lines[index] = 'log_level = "error"'
            path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
            initializer = session + '-init' + str(i); owned.append(initializer)
            docker('run', '--name', initializer, '--label', 'baarne.session=' + session, '--network', 'none', *mounts,
                   '--mount', 'type=bind,source=' + str(home) + ',target=/home', a.image,
                   'node', '/app/lifecycle-worker.mjs', '/home/application', '/home/lab-genesis.json', 'initialize')
        docker('network', 'create', '--internal', '--label', 'baarne.session=' + session, network); network_created = True
        launch = '/bridge --state /home/application --genesis /home/lab-genesis.json --worker /app/lifecycle-worker.mjs & b=$!; /cometbft start --home /home --proxy_app tcp://127.0.0.1:26658 & c=$!; trap "kill $b $c 2>/dev/null" TERM INT; wait -n; kill $b $c 2>/dev/null; wait; exit 1'
        for i, name in enumerate(names):
            owned.append(name)
            docker('create', '--name', name, '--label', 'baarne.session=' + session, '--network', network,
                   '--cpus', '.75', '--memory', '384m', '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                   *mounts, '--mount', 'type=bind,source=' + str(work / 'nodes' / ('node' + str(i))) + ',target=/home', a.image, 'sh', '-c', launch)
            docker('start', name)
        observer_name = session + '-observer'; owned.append(observer_name)
        observer = subprocess.Popen(['docker', 'run', '-i', '--name', observer_name, '--label', 'baarne.session=' + session,
                                     '--network', network, '--memory', '256m', '--cap-drop', 'ALL', *mounts,
                                     a.image, 'node', '/app/observer.mjs', json.dumps(names)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
        wait(lambda: all(int(rpc(i, 'status')['sync_info']['latest_block_height']) >= 2 for i in range(4)), 60)
        receipts = [submit({'kind': 'register', 'index': 3})]
        for index in range(10):
            q = {'kind': 'event', 'index': index}
            if index in [4, 6, 8]: q['time'] = at_height(receipts[-1]['height'])
            receipts.append(submit(q))
        assert not query()['state']['state']['genesis']['open']
        result['checks'].append({'check': 'first_regular_membership_closes_genesis', 'passed': True})
        receipts.append(submit({'kind': 'register', 'index': 4}))
        assert vectors['people'][4] not in query()['state']['state']['members']
        for index in range(10, vectors['eventCount']):
            q = {'kind': 'event', 'index': index}
            if index in [12, 14, 16]: q['time'] = at_height(receipts[-1]['height'])
            receipts.append(submit(q))
        wait(lambda: all(query(i)['state']['state']['members'][vectors['people'][4]]['status'] == 'ACTIVE' for i in range(4)))
        result['checks'].append({'check': 'post_closure_registration_requires_three_references', 'passed': True})
        now = query()['state']['time']; receipts.append(submit({'kind': 'reference', 'epoch': 0, 'time': now}))
        receipts.append(submit({'kind': 'recover'}))
        wait(lambda: all(query(i)['state']['keys'][vectors['people'][0]]['epoch'] == 1 for i in range(4)))
        now = query()['state']['time']; submit({'kind': 'reference', 'epoch': 0, 'time': now}, 1)
        submit({'kind': 'reference', 'epoch': 1, 'useOld': True, 'time': now}, 1)
        receipts.append(submit({'kind': 'reference', 'epoch': 1, 'time': now}))
        result['checks'].append({'check': 'finalized_recovery_rejects_old_epoch_and_forged_new_epoch', 'passed': True})
        docker('kill', names[0]); docker('start', names[0])
        wait(lambda: query(0)['state']['keys'][vectors['people'][0]]['epoch'] == 1, 60)
        wait(lambda: not rpc(0, 'status')['sync_info']['catching_up'])
        assert len(query()['state']['referencesV3']) == 2
        assert len(query()['state']['state']['references']) == 6
        result['checks'].append({'check': 'sigkill_restart_retains_authority_and_both_reference_histories', 'passed': True})
        # The next header commits the final transaction's execution result.
        final_transaction_height = int(receipts[-1]['height'])
        wait(lambda: all(int(rpc(i, 'status')['sync_info']['latest_block_height']) >= final_transaction_height + 2 for i in range(4)))
        height = min(int(rpc(i, 'status')['sync_info']['latest_block_height']) for i in range(4)) - 1
        blocks = [rpc(0, 'block', {'height': str(h)}) for h in range(1, height + 2)]
        replay = exchange(observer, {'operation': 'replay', 'genesis': public_input, 'blocks': blocks[:-1]})
        for h in range(height):
            assert replay['hashes'][h].upper() == blocks[h+1]['block']['header']['app_hash']
            expected = rpc(0, 'block_results', {'height': str(h+1)}).get('txs_results') or []
            assert [r['code'] for r in replay['results'][h]] == [r['code'] for r in expected]
            for i in range(1, 4): assert rpc(i, 'block', {'height': str(h+1)})['block_id']['hash'] == blocks[h]['block_id']['hash']
        result['checks'].append({'check': 'four_nodes_share_block_history_independent_replay_matches_header_roots_and_results', 'passed': True})
        (work / 'public-blocks.json').write_text(json.dumps(blocks), encoding='utf-8')
        result['replayedHeight'] = height; result['stateHash'] = replay['hashes'][-1]; result['acceptedReceipts'] = receipts
        assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() == pin for p, pin in hashes.items())
        result['status'] = 'PASSED'
    except BaseException as e:
        result['error'] = str(e)
        for name in names:
            if name in owned:
                try: result.setdefault('diagnostics', {})[name] = docker('logs', '--tail', '15', name)
                except Exception: pass
        raise
    finally:
        errors = []
        for name in reversed(owned):
            try: docker('rm', '-f', name)
            except Exception as e: errors.append(str(e))
        if network_created:
            try: docker('network', 'rm', network)
            except Exception as e: errors.append(str(e))
        for process in (signer, observer):
            if process:
                try: process.communicate(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.communicate()
        result['cleanupErrors'] = errors; result['elapsedSeconds'] = round(time.monotonic()-start, 3)
        if errors: result['status'] = 'CLEANUP_REQUIRES_ATTENTION'
        with output.open('x', encoding='utf-8') as f: json.dump(result, f, indent=2)
    print(json.dumps({'status': result['status'], 'checks': len(result['checks']), 'output': str(output)}))


if __name__ == '__main__':
    main()
