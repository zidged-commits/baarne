# BAARNE M1 Freeze Report

Date: 2026-10-10  
Review time: 2026-10-10T08:46:11+03:00  
Status: **FEATURE-FROZEN BASELINE; NOT PRODUCTION-CERTIFIED**

## 1. Freeze decision

M1 functionality through Gates F, G, and H is feature-frozen as the reproducible baseline for future M2 work. The frozen scope includes:

- deterministic membership periods and event replay;
- Genesis invitations and automatic first-regular-member closure;
- three concurrent reference slots and their accepted lifecycle;
- immutable `BAARNE_REFERENCE_V1` history;
- six-hop historical graph traversal;
- Gate F signed event envelopes, actor authorization, finalized ordering, and checkpoints;
- Gate G complete signed-event-to-state-hash verification;
- Gate H deterministic content-addressed archive and API-independent full replay.

Feature freeze means new governance behavior must not be added to or silently reinterpreted inside the M1 baseline. Compatible security fixes require regression evidence and an explicit change record. M2 must use new versioned modules/events and must not mutate accepted M1 or M0 history.

This freeze is not a production certification. Gates F, G, and H remain controlled integration evidence with fixture-based M1 chain commitments and same-host archive replicas. Production finality, deployment, storage independence, privacy/legal review, dependency hardening, and governance authorization remain incomplete.

## 2. Reports reviewed

- `docs/M1_IMPLEMENTATION_REPORT.md`
- `docs/M1_SECURITY_GATE_REPORT.md`
- `docs/M1_GATE_F_REPORT.md`
- `docs/M1_GATE_G_REPORT.md`
- `docs/M1_GATE_H_REPORT.md`
- M0/V0.1 governance, privacy, evidence, protocol, network, Death Test, and operations material referenced by their regression suites.

Gate F established cryptographic event authorization and finalized fixture ordering but left governance events unsupported. Gate G closed the automatic Genesis gap and demonstrated end-to-end replay. Gate H demonstrated full recovery with one surviving local archive and correctly failed when every archive was unavailable.

## 3. Exact source identity

### Git condition

The reviewed baseline is now a local root commit on branch `master`:

```text
commit: 5e1f78135e027f4700f1202bc169d96187cc21d5
tag:    baarne-m1-freeze-v0.1 (annotated)
```

The annotated tag resolves to that commit and records the manifest hash plus the 369-test result. It was created only after secret/generated-file exclusions, manifest reproduction, and the full regression succeeded. The commit and tag remain local; neither was pushed.

### Content manifest fallback

The executable baseline is captured in:

- `docs/M1_FREEZE_SOURCE_MANIFEST.json`
- manifest version: `BAARNE_M1_FREEZE_SOURCE_MANIFEST_V1`
- files: **268**
- bytes: **37,737,550**
- aggregate SHA-256: `890730af9e30a79706988c0c91d6d6e5d46b430a265299db4aceb8ca4f0480bd`

The aggregate hashes sorted lines of `<file-sha256><two spaces><repository-relative-path><LF>`. Scope includes executable source, configuration, tests, M0/M1 evidence, governance policy, V0.1 runbooks, and M1 reports through Gate H. Readiness/freeze reports and private/runtime experiment data are excluded to avoid self-reference and secret/runtime inclusion.

Reproduction command:

```powershell
node scripts/create-m1-freeze-manifest.mjs
```

The command reproduces the aggregate committed at the freeze tag.

## 4. Runtime and dependency baseline

```text
Operating environment: Windows / PowerShell
Node.js:              v22.20.0
npm:                  10.9.3
package-lock format:  3
package-lock SHA-256: 33ee3efc4dbd7e76bfddb3b72a389068996a53e0af3f929a6f21cfd0b245760b
TypeScript:           5.8.3
ethers:               6.17.0
EAS SDK:              2.10.0
```

Local workspace packages:

| Package | Version |
| --- | --- |
| `@baarne/chain-abstraction` | 0.1.0 |
| `@baarne/eas-adapter` | 0.1.0 |
| `@baarne/identity` | 0.1.0 |
| `@baarne/membership-archive` | 0.1.0 |
| `@baarne/membership-gate-f` | 0.1.0 |
| `@baarne/membership-state` | 0.1.0 |
| `@baarne/trust-protocol` | 0.1.0 |
| `@baarne/v0.1-core` | 0.1.0 |
| `@baarne/v0.1-node` | 0.1.0 |

`npm install --ignore-scripts` synchronized local workspace links. `npm ls --depth=0 --json` then completed without missing-workspace errors. npm reported 32 dependency advisories: 17 low, 4 moderate, and 11 high. This is an inventory result, not an exploitability finding. Triage and lockfile-preserving remediation are required before any production claim; no automatic `npm audit fix` was run.

## 5. Freeze regression

Commands executed for this review:

```powershell
npm install --ignore-scripts
npm test
node --test tests/admission.test.mjs tests/v0.1/core.test.mjs tests/v0.1/security.test.mjs
& '.\.tools\node-v22.23.3\node.exe' --test tests/v0.1/network.acceptance.mjs
& '.\.tools\node-v22.23.3\node.exe' --test tests/v0.1/operations/operations.test.mjs tests/v0.1/operations/documentation.test.mjs
npm run check:scaffold
node scripts/create-m1-freeze-manifest.mjs
```

Results:

| Suite | Result |
| --- | ---: |
| Root M0/M1, Gates F/G/H, strict TypeScript | 312 passed |
| Gate 0G and V0.1 core/security | 54 passed |
| Real five-process V0.1 network and Company Death | 1 passed |
| V0.1 operations/documentation | 2 passed |
| Gate 0A scaffold | passed |
| Non-overlapping test total | **369 passed, 0 failed, 0 skipped** |

## 6. M0 backward compatibility

The freeze run verified:

- unchanged `BAARNE_REFERENCE_V1` canonical records, hashes, golden vectors, and EIP-191 authorization behavior;
- existing EAS adapter schema and evidence separation;
- Gate 0F disappearance and independent Python verification;
- Gate 0G/V0.1 capacity conservation, replay, and security cases;
- unchanged V0.1 4-of-5 certificate behavior;
- real five-process network and Company Death continuation;
- existing V0.1 operations and documentation runbooks.

M1 remains a separate versioned domain package. It does not reinterpret M0/V0.1 records or replace V0.1 capacity/finality semantics. No deployed contract, EAS schema, live attestation, or golden vector was modified.

## 7. Implemented versus controlled/simulated

| Capability | Status |
| --- | --- |
| M1 canonical events and deterministic transitions | Implemented and unit/adversarial tested |
| Genesis automatic closure | Implemented and race-tested |
| M1 EIP-191 signed event envelope | Implemented and cryptographically tested |
| Actor authorization for supported M1 events | Implemented against preceding state |
| Suspension/expulsion authority | Not implemented; fails `UNSUPPORTED_POLICY` |
| Finalized Base Sepolia ordering reader | Implemented read-only normalization/corroboration boundary |
| Live M1 event commitments | Not deployed; fixtures only |
| Proposed M1 EAS schema | Assessed only; not registered |
| Complete API-independent replay | Implemented against finalized fixtures |
| Three archive replicas | Same-host filesystem roots; controlled experiment |
| Independent storage organizations/machines | Not demonstrated |
| Production monitoring, repair, retention SLA | Not implemented |
| Production privacy/legal approval | Not completed |
| Production Byzantine/finality guarantee | External assumption, not demonstrated by M1 |

## 8. Remaining deployment dependencies

### Live commitments and inclusion evidence

A real verifier needs live, finalized M1 commitment logs, exact contract/schema identity, transaction receipts/logs, finalized block hashes/timestamps, and complete discovery from independently operated chain data sources. Fixtures prove code paths, not live inclusion.

### Commitment mechanism

The proposed EAS schema is:

```text
bytes32 membershipEventId,bytes32 authorizationEnvelopeHash
```

It has not been registered. Before deployment, the schema/contract choice, decoder, upgrade/version policy, cost, privacy leakage, and chain migration behavior require review. An equivalent non-EAS mechanism may be used only if it preserves independently verifiable inclusion/order and exact commitment binding.

### Independent storage

Gate H requires actual independent operators, separate machines/accounts/failure domains, authenticated discovery, replication monitoring, repair, restore drills, and archive export. Three directories on one host do not satisfy this operational requirement.

### Long-term availability

At least one complete event/envelope/evidence copy must survive. Hashes, IPFS CIDs, and pins authenticate/retain under bounded conditions but do not create missing preimages. Long-term software, canonical specifications, Genesis, chain history, and cryptographic verification tools must also survive.

### Privacy and legal review

Current independent replay reveals stable pseudonymous identities, reference edges, event timing, and historical graph structure. Negative opinions, suspension evidence, ballots, reviewer conflicts, and case records would increase sensitivity. Qualified GDPR/KVKK, retention, deletion, lawful-basis, data-subject-rights, defamation, and cross-border review is required before real participants.

### Production network/finality

Base Sepolia is a testnet dependency in Gate F. Production must explicitly select a chain/network, finality threshold, RPC independence policy, reorg handling, censorship/availability assumptions, migration strategy, and response to chain/RPC loss. EAS existence never substitutes for BAARNE authorization validity.

### Security and operations

Dependency advisories, key custody/recovery, incident response, signer/member compromise, monitoring, rate limiting, archive audits, and external security review remain production blockers.

## 9. Freeze tag

Immutable annotated tag:

```text
baarne-m1-freeze-v0.1
```

Verification commands:

```powershell
git rev-parse 'baarne-m1-freeze-v0.1^{commit}'
git show baarne-m1-freeze-v0.1:docs/M1_FREEZE_SOURCE_MANIFEST.json
git tag -n99 baarne-m1-freeze-v0.1
```

The tag must never be moved or overwritten. Pushing the commit or tag requires separate authorization.

## 10. Freeze status

**M1 FEATURE FREEZE: ESTABLISHED AT `baarne-m1-freeze-v0.1` / `5e1f78135e027f4700f1202bc169d96187cc21d5`.**

**PRODUCTION CERTIFICATION: NOT GRANTED.**

At freeze time M2 was not implemented. No schema was registered, no contract was deployed, no blockchain transaction was submitted, and no repository changes were pushed.
