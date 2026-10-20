# BAARNE M1 Gate H — Independent Data Survival

Date: 2026-10-10  
Scope: deterministic public event archive, three independent storage roots, API-free clean reconstruction, failure testing, and local resource measurement. No contract deployment, EAS schema registration, blockchain transaction, M0 format change, or M2 work occurred.

## 1. Recommendation

**CONDITIONAL PASS**

Three logically independent archive replicas were created under separate filesystem roots. Starting with only Genesis, two independent finalized-chain views, and the surviving archive objects, a fresh verifier discovered all 13 finalized commitments, retrieved and revalidated the corresponding canonical events and signed envelopes, replayed the complete history, and reproduced the reference verifier's accepted list, rejected list, full state, and state hash.

Recovery succeeded with one archive unavailable and with two archives unavailable. With all archives unavailable, reconstruction returned `CONTENT_UNAVAILABLE` and no state; it never interpreted the condition as an empty valid history.

The result is conditional because the replicas were isolated roots on one machine, not independent operators, machines, jurisdictions, or Internet failure domains. The experiment proves the format and recovery path, not long-term production availability. A durable deployment still needs independently operated replication, discovery, monitoring, repair, and periodic restore tests.

## 2. Reused evidence and architecture

Gate H reuses rather than replaces existing components:

- The M0 IPFS experiment established that exact bytes can be retrieved and verified by CID after the original publisher disappears, while zero reachable holders makes retrieval fail. It also established that pinning is retention behavior, not a permanence guarantee.
- M0 `BAARNE_REFERENCE_V1` canonical records and portable signatures remain the reference evidence inside M1 events.
- M1 provides strict event validation, atomic transitions, Genesis replay, immutable references, and deterministic state hashes.
- Gate F provides signed event envelopes, authorization policy, nonce/replay protection, finalized Base Sepolia evidence, independent RPC comparison, and ordered replay.
- Gate G provides automatic Genesis closure and the source-neutral `get(kind, hash)` retrieval boundary.

No new distributed storage network was introduced. The new package is a minimal filesystem adapter for the existing content-addressing boundary. Its objects can later be transported by ordinary file copying, peer exchange, IPFS, or another byte-preserving mechanism without changing their protocol meaning.

## 3. Architecture

```text
Independent finalized RPC view A ----+
                                      +--> common finalized commitments
Independent finalized RPC view B ----+        |
                                               v
                          eventId + authorizationEnvelopeHash
                                               |
                         +---------------------+---------------------+
                         |                     |                     |
                    Archive A             Archive B             Archive C
                    own root              own root              own root
                         |                     |                     |
                         +---------- content-addressed read --------+
                                               |
                                               v
                         strict parse + hash + signature verification
                                               |
                                               v
                           finalized ordering + M1 replay from Genesis
                                               |
                                               v
                          accepted/rejected events + stateHash
```

Archive operators do not decide ordering, authorization, validity, or membership. Their role is to retain and return bytes. The finalized chain commitments define the required object set and order; the verifier checks archive indexes against that independently discovered set.

## 4. Archive format

Version: `BAARNE_M1_EVENT_ARCHIVE_V1`  
Layout: `BAARNE_M1_ARCHIVE_OBJECTS_V1`  
Canonicalization: `BAARNE_RESTRICTED_CANONICAL_JSON_V1`  
Hash algorithm: domain-separated SHA-256

Directory layout:

```text
archive-root/
  manifest.json
  objects/
    events/<membershipEventId>.json
    authorizations/<authorizationEnvelopeHash>.json
    evidence/<archiveEvidenceHash>.json
```

`manifest.json` contains exactly:

```text
archiveVersion
canonicalization
chainId
entries[]
genesisHash
hashAlgorithm
layout
manifestHash
networkId
protocolVersion
schemaUid
```

Each entry contains:

```text
eventId
authorizationHash
evidenceHash
position = [blockNumber, transactionIndex, logIndex]
```

Entries are sorted by finalized position. The manifest is deterministic: all three replicas built from the same history had the same `manifestHash` and byte-identical logical content.

### Integrity layers

- `eventId` is the existing M1 domain-separated commitment to the complete strict canonical event.
- `authorizationHash` is the existing Gate F commitment to the complete signed envelope.
- `evidenceHash` is a Gate H domain-separated commitment to the complete normalized finalized inclusion evidence.
- `manifestHash` commits the archive version, scope, Genesis anchor, layout, and ordered object references.

These hashes authenticate retrieved bytes under their cryptographic assumptions. They do not prove availability, authorization, correct policy, or finalized inclusion by themselves.

## 5. Clean independent reconstruction

The tested clean reconstruction performs these steps:

1. Normalize and compare two independent finalized RPC views.
2. Select their common finalized height and require the same finalized block hash and complete log set.
3. Derive the ordered list of `(eventId, authorizationHash)` commitments without consulting an archive index.
4. Open each available archive and verify its manifest version, protocol, network, chain, schema, Genesis hash, manifest hash, positions, and coverage.
5. Verify every archived evidence object against the independently discovered finalized evidence.
6. Fetch canonical event and authorization objects by their committed hashes.
7. Strictly parse and recompute every event ID and authorization hash.
8. Verify each real EIP-191 signed envelope and actor authority against preceding state.
9. Apply the event at finalized `(blockNumber, transactionIndex, logIndex)` order.
10. Reconstruct state from Genesis without accepting a trusted checkpoint.
11. Compare accepted events, rejected events, state, and state hash with the reference verifier.

The 13-event history contains successful invitation/application/reservation/reference/activation events and finalized but rejected events: an unsupported standalone closure, a post-closure invitation, and duplicate activation. Reconstruction reproduced all positive and negative results. No BAARNE API, database, server snapshot, or administrator assertion was queried.

## 6. Failure and attack results

| Scenario | Result | Classification |
| --- | --- | --- |
| All three archives available | Complete replay; identical state hash | `VERIFIED` |
| Archive A unavailable | B/C recover complete history | `VERIFIED`, degraded replication |
| Archives A and B unavailable | C alone recovers complete history | `VERIFIED`, single-copy risk |
| All archives unavailable | No state returned | `CONTENT_UNAVAILABLE` |
| Malformed object at correct path | Strict parser/hash rejects it | `CONTENT_HASH_MISMATCH` |
| Valid different event substituted at expected path | Recomputed event ID differs | `CONTENT_HASH_MISMATCH` |
| Valid but truncated archive manifest | Compared with chain-required set | `ARCHIVE_INDEX_INCONSISTENT` |
| Truncated archive plus healthy archive | Bad index reported; healthy replica recovers | `VERIFIED` with diagnostics |
| Only truncated archive survives | No partial replay | `ARCHIVE_INCONSISTENT` |
| Interrupted read | No partial state; retry from immutable objects succeeds | `ARCHIVE_READ_INTERRUPTED`, then `VERIFIED` |
| Wrong BAARNE network identity | Rejected before reconstruction | `EVIDENCE_SCOPE_MISMATCH` |
| Finalized invalid signed envelope | Preserved in audit history, cryptographically rejected by replay | rejected signature result |
| Original API unavailable/restarted verifier | New archive reader instances reproduce reference state | `VERIFIED` |

An unavailable or incomplete archive never becomes evidence of an empty membership history. A missing object is an availability/incompleteness result, while an object whose bytes fail its commitment is an integrity result.

## 7. Independent replica behavior

Each `FilesystemMembershipArchive` has its own root and independently controlled availability. Restart is modeled by discarding writer/reader objects and opening new readers from the retained roots. No reader has a fallback URL or BAARNE API callback.

The recovery layer inspects every supplied archive and records per-replica diagnostics. Only archives whose manifest/evidence set exactly matches the finalized required history are eligible object sources. A malicious or stale index cannot shorten the required chain history because required commitments are discovered first from corroborated finalized logs.

This does not make the archives Byzantine consensus participants. If the finalized-chain discovery source is itself incomplete and all compared RPC sources share that incomplete view, the archive layer cannot discover the omission.

## 8. Privacy boundary

The public archive contains only material required by the current independent verification path:

- canonical M1 event fields;
- Gate F signed authorization envelopes;
- public `BAARNE_REFERENCE_V1` records and their portable authorizations when embedded in reference events;
- finalized ordering/inclusion evidence;
- protocol, network, chain, schema, and Genesis commitments.

It does not contain private keys, seed phrases, database IDs, contact details, private reference explanations, private messages, or application-only evidence. Strict canonical validators reject extra event/reference fields, and the archive writer only accepts those validated protocol objects.

This boundary still exposes pseudonymous identities, reference edges, event timing, membership activity, and the historical social graph required by the present M1 replay model. Gate H does not solve that metadata privacy problem.

Access-controlled explanations or personal data must remain outside the public immutable archive with a separate retention/access policy. Encrypting such data would reduce plaintext disclosure but would not make immutable ciphertext erasable, satisfy every GDPR/KVKK obligation, prevent metadata leakage, or solve key retention and loss. No legal-compliance claim is made.

## 9. Trust assumptions

1. The verifier starts from the authentic Genesis object and expected protocol/network/schema identifiers.
2. Base Sepolia consensus/finality supplies the prototype order and inclusion boundary.
3. At least two chain views are independently obtained and sufficiently complete; matching colluding/common-upstream omissions remain possible.
4. At least one complete, readable archive copy survives and its address/root can be discovered.
5. SHA-256 collision resistance, EIP-191/ECDSA security, canonical parsers, and verifier software remain sound and available.
6. Archive availability monitoring and repair are operational responsibilities; a CID/hash cannot recreate lost bytes.
7. Stable cryptographic identities do not prove human uniqueness or truthful acquaintance.
8. No trusted checkpoint is used. Every tested recovery starts from Genesis and full finalized history.

## 10. Resource measurements

Measured on the local test host with 13 finalized events:

| Metric | Result |
| --- | ---: |
| One archive | 31,193 bytes |
| Files per archive | 40 |
| Three replicas | 93,579 bytes |
| Archive reads during three-replica audit/replay | A: 40, B: 14, C: 14 |
| Retrieval, verification, and replay | 196.611 ms |

The 40 files are one manifest plus three objects per event. The measured run inspects each replica's manifest/evidence and retrieves event/envelope objects from the first complete source. Results are local warm/cold-filesystem-dependent measurements, not network or mobile benchmarks.

### Storage projections

The tested mix averages approximately 2,399 bytes per finalized event per archive, including its share of the manifest. The following simple projections assume the same event/reference-size mix, no compression, no block packing, no content deduplication benefit, and exclude filesystem allocation overhead, indexes, transport framing, backups, and logs:

| Finalized events | One logical archive | Three complete replicas | Approximate files per replica |
| ---: | ---: | ---: | ---: |
| 1,000 | 2.29 MiB | 6.86 MiB | 3,001 |
| 10,000 | 22.88 MiB | 68.65 MiB | 30,001 |
| 100,000 | 228.83 MiB | 686.50 MiB | 300,001 |
| 1,000,000 | 2.23 GiB | 6.70 GiB | 3,000,001 |

Space is approximately `O(events × replicas)`. Clean replay and complete manifest/evidence inspection are `O(events)`; cryptographic verification cost also scales with events and embedded references. The small-file layout is inspectable but will become operationally inefficient at large scale. Packing/indexing can reduce filesystem overhead later without changing object commitments, but was not added in this gate.

The single 13-event timing must not be extrapolated as a reliable 100,000-event runtime. Larger-dataset and real multi-host benchmarks remain required before production sizing.

## 11. Test results

Commands:

```powershell
npm run test:m1:gate-h
npm test
node --test tests/admission.test.mjs tests/v0.1/core.test.mjs tests/v0.1/security.test.mjs
& '.\.tools\node-v22.23.3\node.exe' --test tests/v0.1/network.acceptance.mjs
& '.\.tools\node-v22.23.3\node.exe' --test tests/v0.1/operations/operations.test.mjs tests/v0.1/operations/documentation.test.mjs
```

Results:

- Gate H focused: **10/10 passed**.
- Root M0/M1 suite including Gates F, G, and H: **312/312 passed**, plus strict TypeScript.
- Gate 0G/V0.1 core/security: **54/54 passed**.
- Real five-process V0.1 network and Company Death continuation: **1/1 passed**.
- V0.1 operations/documentation: **2/2 passed**.
- Non-overlapping full total: **369 passed, 0 failed, 0 skipped**.

## 12. Remaining risks

1. All three roots are on one machine. Common disk, OS, account, ransomware, fire, and operator failures were not eliminated.
2. Internet discovery, authenticated mirror lists, replication repair, retention monitoring, and multi-operator procedures are not implemented.
3. The proposed M1 EAS schema remains undeployed, so finalized commitments are controlled fixtures rather than live M1 attestations.
4. All-copy loss is unrecoverable from hashes alone.
5. Archive objects reveal the current public verification graph and timing metadata.
6. Large histories need packed storage/index experiments and independent verifier performance measurements.
7. Chain/RPC common-mode omission and long-term chain data availability remain external dependencies.
8. Cryptographic algorithm and verifier-software preservation are long-term requirements.
9. Local archive success is not production readiness or a permanence guarantee.

## 13. Files

Created:

- `packages/membership-archive/package.json`
- `packages/membership-archive/README.md`
- `packages/membership-archive/src/index.mjs`
- `tests/helpers/m1-gate-h-fixture.mjs`
- `tests/membership-gate-h.test.mjs`
- `docs/M1_GATE_H_REPORT.md`

Modified compatibly:

- `packages/membership-gate-f/src/index.mjs` — exposes finalized commitment discovery before content retrieval; existing ordering verification reuses the same checked result.
- `package.json` — adds the focused Gate H test and root-suite coverage.
- `package-lock.json` — records the new local workspace package; no deliberate dependency-version upgrade was made.

Existing M0 canonical formats, `BAARNE_REFERENCE_V1`, golden vectors, deployed EAS schemas, contracts, V0.1 finality semantics, and live chain state were not changed. No schema was registered, no contract was deployed, no blockchain transaction was submitted, and M2 was not started.
