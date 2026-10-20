"""V3 synthetic four-process integration. Internal Docker network, no published ports.
Reuses approved pinned artifacts. Evidence contains public records only.
"""
import argparse
import importlib.util
import os
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
    for field in ('kit','application-review','work-dir','output'):
        parser.add_argument('--'+field,required=True)
    a=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parent.parent
    kit=pathlib.Path(a.kit).resolve(strict=True)
    spec=importlib.util.spec_from_file_location('k4_inputs',root/'scripts/k4-inputs.py')
    inputs=importlib.util.module_from_spec(spec);spec.loader.exec_module(inputs)
    validated=inputs.validate_inputs(kit,a.application_review,root);record=validated['record']
    binary,bridge,app=kit/'bin/cometbft',kit/'bin/bridge',validated['app']
    a.image='sha256:3b4a11519ad929d1e1d261a12cff056f0c85b735253d7d861346b9c6f8b36437'
    fixture=root/'tests/fixtures/k4-lifecycle-vectors.mjs'
    work, output = pathlib.Path(a.work_dir).resolve(), pathlib.Path(a.output).resolve()
    if work.exists() or output.exists() or not a.image.startswith('sha256:'):
        raise ValueError('Fresh output/work and pinned existing image required')
    work.mkdir(parents=True)
    session = 'baarne-v3-' + uuid.uuid4().hex[:12]
    names = [session + '-node' + str(i) for i in range(4)]
    network = session + '-net'
    owned, network_created, signer, observer = [], False, None, None
    partition_network=network+'-partition';partition_created=False
    start = time.monotonic()
    sources = [pathlib.Path(__file__), *app.glob('*.mjs'), app / 'bridge.go',fixture]
    hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    result = {'status': 'INTERRUPTED', 'mode': 'FOUR_LOCAL_SYNTHETIC_VALIDATORS', 'livePilotAuthorized': False,
              'independentOperators': False, 'offlineCertificateVerified': False,'kitManifestSha256':record['kitManifestSha256'],'nodeRuntime':'24.22.0', 'checks': [], 'sourceHashes': hashes,
              'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
              'bridgeSha256': hashlib.sha256(bridge.read_bytes()).hexdigest(), 'runtimeImage': a.image}
    mounts = ['--mount', 'type=bind,source=' + str(binary) + ',target=/cometbft,readonly',
              '--mount', 'type=bind,source=' + str(bridge) + ',target=/bridge,readonly',
              '--mount', 'type=bind,source=' + str(app) + ',target=/app,readonly',
              '--mount', 'type=bind,source=' + str(app.parent.parent / 'packages') + ',target=/packages,readonly',
              '--mount', 'type=bind,source=' + str(app.parent.parent / 'node_modules') + ',target=/node_modules,readonly',
              '-e', 'NODE_OPTIONS=--experimental-strip-types',
              '--mount','type=bind,source='+str(kit/'runtime/linux-x64')+',target=/runtime,readonly',
              '--mount','type=bind,source='+str(app.parent)+',target=/experiments,readonly',
              '--mount','type=bind,source='+str(fixture)+',target=/k4-fixture.mjs,readonly',
              '-e','PATH=/runtime:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']

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
        deadline = min(start + 420, time.monotonic() + seconds)
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
        version_name=session+'-runtime';owned.append(version_name)
        runtime=json.loads(docker('run','--name',version_name,'--label','baarne.session='+session,'--network','none',*mounts,a.image,'node','-p','JSON.stringify(process.versions)'))
        assert runtime['node']=='24.22.0' and runtime['undici']=='7.29.1'
        result['runtimeVersions']=runtime
        setup = session + '-setup'; owned.append(setup)
        docker('run', '--name', setup, '--label', 'baarne.session=' + session, '--network', 'none', *mounts,
               '--mount', 'type=bind,source=' + str(work) + ',target=/work', a.image,
               '/cometbft', 'testnet', '--v', '4', '--o', '/work/nodes', '--hostname-prefix', session + '-node')
        generator = session + '-signer'; owned.append(generator)
        signer = subprocess.Popen(['docker', 'run', '-i', '--name', generator, '--label', 'baarne.session=' + session,
                                   '--network', 'none', *mounts, a.image, 'node', '/k4-fixture.mjs', str(int(time.time()) - 60)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
        line = signer.stdout.readline()
        if not line:
            raise RuntimeError('Fixture generation failed')
        vectors = json.loads(line)
        public_input = {'config': vectors['config'], 'bootstrap': vectors['bootstrap']}
        (work / 'public-input.json').write_text(json.dumps(public_input,sort_keys=True,separators=(',',':')), encoding='utf-8')
        for i, name in enumerate(names):
            home = work / 'nodes' / ('node' + str(i))
            (home / 'lab-genesis.json').write_text(json.dumps(public_input,sort_keys=True,separators=(',',':')), encoding='utf-8')
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
                   *mounts, '--mount', 'type=bind,source=' + str(work / 'nodes' / ('node' + str(i))) + ',target=/home', a.image, '/bin/bash', '-c', launch)
            docker('start', name)
        observer_name = session + '-observer'; owned.append(observer_name)
        observer = subprocess.Popen(['docker', 'run', '-i', '--name', observer_name, '--label', 'baarne.session=' + session,
                                     '--network', network, '--memory', '256m', '--cap-drop', 'ALL', *mounts,
                                     a.image, 'node', '/app/observer.mjs', json.dumps(names)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
        wait(lambda: all(int(rpc(i, 'status')['sync_info']['latest_block_height']) >= 2 for i in range(4)), 60)
        # Save the signed public intent before any network transmission.
        pending_raw=exchange(signer,{'kind':'register','index':3})['tx']
        pending_hash=hashlib.sha256(pending_raw.encode()).hexdigest().upper()
        pending={'version':'BAARNE_K4_PENDING_PUBLIC_RECEIPT_V1','tx':pending_raw,'hash':pending_hash}
        pending_path=work/'pending-public-receipt.json'
        with pending_path.open('x',encoding='utf8') as f:
            json.dump(pending,f);f.flush();os.fsync(f.fileno())
        lost=exchange(observer,{'node':0,'operation':'discardResponse','method':'broadcast_tx_commit','params':{'tx':base64.b64encode(pending_raw.encode()).decode()}})
        assert lost['status']=='UNKNOWN'
        pending=json.loads(pending_path.read_text(encoding='utf8'))
        recovered=wait(lambda:receipt(pending['hash']))
        assert recovered['tx_result']['code']==0 and recovered['tx']==base64.b64encode(pending['tx'].encode()).decode()
        receipts=[recovered]
        baseline_count=query()['info']['acceptedCount']
        try:
            retry=rpc(0,'broadcast_tx_sync',{'tx':recovered['tx']})
            assert retry['code']==0,retry
        except RuntimeError as error:
            assert 'already exists in cache' in str(error),str(error)
        retry_height=int(receipts[0]['height'])
        wait(lambda:int(rpc(0,'status')['sync_info']['latest_block_height'])>=retry_height+2)
        assert query()['info']['acceptedCount']==baseline_count==1
        assert len(query()['state']['keys'])==4
        try:receipt('00'*32)
        except RuntimeError as error:assert 'not found' in str(error),str(error)
        else:raise AssertionError('Unknown receipt must not be success')
        result['checks'].append({'check':'durable_intent_response_loss_unknown_lookup_retry_no_double_effect','passed':True})
        submit({'kind':'event','index':0,'foreign':True},1)
        submit({'kind':'event','index':0,'signerIndex':1},1)
        submit({'kind':'unsupported-migration'},1)
        result['checks'].append({'check':'wrong_network_unauthorized_actor_and_admin_migration_rejected','passed':True})
        for index in range(10):
            q = {'kind': 'event', 'index': index}
            if index in [4, 6, 8]: q['time'] = at_height(receipts[-1]['height'])
            receipts.append(submit(q))
            if index==3:submit({'kind':'event','index':3,'conflict':True},1)
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
        receipts.append(submit({'kind':'resign','index':3}))
        wait(lambda:all(query(i)['state']['state']['members'][vectors['people'][3]]['status']=='RESIGNED' for i in range(4)))
        assert len(query()['state']['state']['references'])==6
        result['checks'].append({'check':'voluntary_resignation_preserves_original_reference_history','passed':True})
        docker('stop','--time','5',names[3])
        h=int(rpc(0,'status')['sync_info']['latest_block_height'])
        wait(lambda:int(rpc(0,'status')['sync_info']['latest_block_height'])>=h+2)
        result['checks'].append({'check':'three_of_four_progresses','passed':True})
        docker('start',names[3]);wait(lambda:not rpc(3,'status')['sync_info']['catching_up'])
        docker('network','create','--internal','--label','baarne.session='+session,partition_network);partition_created=True
        docker('network','connect',partition_network,observer_name)
        for i in [2,3]:
            docker('network','connect',partition_network,names[i]);docker('network','disconnect',network,names[i])
        # Topology changes invalidate HTTP/DNS connection pools. Start a fresh
        # read-only observer on the same two networks, not cached old sockets.
        docker('kill',observer_name);observer.communicate(timeout=5)
        observer=subprocess.Popen(['docker','start','-ai',observer_name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf-8')
        time.sleep(3)
        before=[wait(lambda i=i:int(rpc(i,'status')['sync_info']['latest_block_height']),20) for i in range(4)]
        time.sleep(3)
        after=[wait(lambda i=i:int(rpc(i,'status')['sync_info']['latest_block_height']),20) for i in range(4)]
        assert before==after,{'before':before,'after':after}
        result['checks'].append({'check':'two_plus_two_partition_neither_side_advances','passed':True,'heights':after})
        docker('stop','--time','5',names[2],names[3])
        for i in [2,3]:
            docker('network','connect',network,names[i]);docker('network','disconnect',partition_network,names[i])
        docker('start',names[2],names[3])
        docker('kill',observer_name);observer.communicate(timeout=5)
        observer=subprocess.Popen(['docker','start','-ai',observer_name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf-8')
        wait(lambda:all(int(rpc(i,'status')['sync_info']['latest_block_height'])>max(after)+2 for i in range(4)),60)
        result['checks'].append({'check':'partition_rejoin_resumes_single_history','passed':True})
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
        if partition_created:
            try:docker('network','rm',partition_network)
            except Exception as e:errors.append(str(e))
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
    if result['status']!='PASSED':raise RuntimeError('Incomplete K4 run')
    print(json.dumps({'status': result['status'], 'checks': len(result['checks']), 'output': str(output)}))


if __name__ == '__main__':
    main()
