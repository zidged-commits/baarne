# BAARNE M1 Gate F — Authorization, Ordering and Finality

Date: 2026-10-10  
Scope: isolated Base Sepolia integration prototype for M1 membership events. No contract deployment, schema registration, transaction submission, live EAS mutation, M0 record change, or M2 work occurred.

## 1. Recommendation

**CONDITIONAL PASS**

The implemented prototype cryptographically authorizes supported M1 events, orders them by corroborated Base Sepolia finalized chain position, supplies finalized block time to time-sensitive M1 policy, and deterministically replays the resulting history. Two independently initialized verifiers produced the same accepted events, rejected events, state, and state hash.

The gate remains conditional because three M1 events have no accepted signer authority (`GENESIS_CLOSED`, `MEMBERSHIP_SUSPENDED`, `MEMBERSHIP_EXPELLED`), the required M1 commitment schema is not deployed, and no live M1 event history exists. The prototype is therefore independently testable with real signatures, normalized finalized-log fixtures, mocked raw RPC responses, and a live read-only finalized-head check; it is not a production event network.

## 2. Reused architecture

- M0's EIP-191 `eip191-personal-sign-v1` verifier, low-s ECDSA rules, and `evm-eoa:` identity identifiers are reused. The membership envelope has a new domain and does not alter `BAARNE_REFERENCE_V1` or `BAARNE_SIGNATURE_V1`.
- M1 canonical events, event IDs, strict payload validation, state commitments, reference-package verification, atomic transitions, and `authorizeEvent` boundary remain the domain core.
- M1 now has two optional integration switches. Defaults remain unchanged: `EVENT_TUPLE` ordering and event-supplied `occurredAt`. Gate F selects `EXTERNAL_FINALIZED` and resolves transition time from the finalized block timestamp.
- The EAS adapter's explicit Base Sepolia chain profile, finalized-read policy, fixed-block recheck, and evidence/authorization separation informed the read-only Gate F RPC boundary.
- Existing V0.1 4-of-5 network and Company Death tests remain unchanged. They are regression evidence, not Gate F's finality mechanism.

## 3. Architecture and trust boundaries

```text
client-held EVM key
        |
        | EIP-191 signed membership authorization
        v
portable M1 event + authorization envelope
        |
        | hash-only chain commitment
        v
Base Sepolia finalized log position
        |
        | independent RPC observations
        v
Gate F policy authorization against preceding state
        |
        v
M1 deterministic transition + state hash
```

The layers establish separate claims:

| Layer | Establishes | Does not establish |
| --- | --- | --- |
| Canonical event | Exact M1 fields, payload, network and deterministic event ID | Actor identity, ordering, finality |
| EIP-191 envelope | The EVM key controlling `signer` authorized the exact envelope body | Human identity, fair inclusion, governance legitimacy |
| Authorization policy | The signer is the documented actor in the exact preceding state | Authority for unsupported governance events |
| Base Sepolia evidence | The commitment had a finalized `(block, transaction, log)` position under the observed chain | BAARNE validity; an EAS UID is never sufficient |
| RPC corroboration | Two named RPC views agree through a common finalized block and log set | Protection from colluding/common-mode omission |
| M1 transition | Accepted ordered events produce the committed state atomically | History completeness beyond the verified range or Byzantine fault tolerance |

No central sequencer was added. Base Sepolia supplies external ordering/finality for this prototype. RPC services are observers, not BAARNE authorities. Private keys remain in the client signer callback.

## 4. Signed event envelope specification

Envelope version: `BAARNE_MEMBERSHIP_AUTHORIZATION_V1`  
Protocol version: `BAARNE_M1_GATE_F_V1`  
Event version: `BAARNE_MEMBERSHIP_EVENT_V1`  
Signature method: `eip191-personal-sign-v1`

Exact fields:

```text
authorizationVersion
chainId                   = 84532
eventId                   = canonical M1 event ID
eventType
eventVersion
networkId
nonce                     = 32 bytes
payloadHash               = SHA-256("BAARNE_MEMBERSHIP_EVENT_PAYLOAD_V1\n" || canonical payload)
protocolVersion
signatureMethod
signatureType             = BAARNE_MEMBERSHIP_EVENT_SIGNATURE_V1
signatureVersion          = 1
signer                     = evm-eoa:0x...
signature                  = 65-byte low-s EIP-191 signature
```

The signed bytes are:

```text
"BAARNE_MEMBERSHIP_AUTHORIZATION_V1\n"
+ restricted canonical JSON of every field above except signature
```

The event ID independently binds event version, network, event type, signed local time and canonical payload. The envelope repeats and verifies the security-relevant event bindings so a signature cannot cross chains, BAARNE networks, event types, payloads, versions, or event IDs. The nonce is scoped by signer and is consumed by the first finalized cryptographically valid envelope observed in chain order, including one later rejected by policy or transition. Exact duplicate delivery at one chain position is idempotently collapsed; reuse at another position is rejected.

`occurredAt` remains part of the signed historical event, but Gate F does not use it for ordering or time-window policy. The finalized block timestamp is supplied to M1 as authoritative transition time. The backdating regression proves an invitation signed with a pre-closure `occurredAt` is rejected when finalized after the Genesis boundary.

## 5. Authorization matrix

Authorization is evaluated against the state immediately preceding the event in finalized chain order.

| Event | Required signer | Additional state requirement | Gate F result |
| --- | --- | --- | --- |
| `FOUNDER_INVITATION_ISSUED` | `payload.founder` | Active committed Genesis founder; Genesis open | Supported |
| `GENESIS_CLOSED` | No authority defined by M1 | Closure time alone does not identify a signer | `UNSUPPORTED_POLICY` |
| `APPLICATION_OPENED` | `payload.candidate` | M1 validates invitation/eligibility | Supported |
| `APPLICATION_CANCELLED` | `payload.candidate` | M1 validates matching cancellable application | Supported |
| `REFERENCE_SLOT_RESERVED` | `payload.issuer` | Issuer ACTIVE in preceding state | Supported |
| `REFERENCE_SLOT_RELEASED` | `payload.issuer` | M1 validates active unconsumed reservation | Supported |
| `REFERENCE_RECORDED` | Reservation issuer from preceding state | M0/V0.1 reference package remains independently verified and issuer/subject-bound | Supported |
| `MEMBERSHIP_ACTIVATED` | `payload.candidate` | M1 requires READY application and three distinct references | Supported |
| `MEMBERSHIP_RESIGNED` | `payload.member` | M1 requires ACTIVE membership | Supported |
| `MEMBERSHIP_SUSPENDED` | No production voting/decision authority exists | `decisionRef` is only opaque evidence | `UNSUPPORTED_POLICY` |
| `MEMBERSHIP_EXPELLED` | No production voting/decision authority exists | `decisionRef` is only opaque evidence | `UNSUPPORTED_POLICY` |

This matrix introduces no administrator. Unsupported transitions fail closed instead of granting authority to founders, operators, EAS attesters, or the BAARNE company.

## 6. Finalized ordering model

The normalized evidence object commits the portable event and authorization to:

```text
chainId, networkId, schemaUid, attestationUid,
eventId, authorizationHash,
blockNumber, blockHash, blockTimestamp,
transactionHash, transactionIndex, logIndex
```

Order is strictly:

```text
(blockNumber, transactionIndex, logIndex)
```

No local timestamp is an ordering key. Same-timestamp conflicts resolve only by finalized chain position. A chain position cannot contain two different commitments.

The RPC reader performs only `eth_chainId`, `eth_getBlockByNumber`, and `eth_getLogs`. It rejects wrong chain, pre-final logs, removed logs, malformed quantities, changed block hashes, or a finalized head that moves backward/changes at the same height during a read. The multi-provider verifier chooses the lowest reported finalized height, requires the same block hash at that height, requires the same complete normalized log set through that height, and verifies every evidence block hash/timestamp. Disagreement or a missing log stops replay.

Logs above the common finalized height are ignored. Thus pre-final reorganization candidates do not enter M1 state. The safe response to finality/RPC uncertainty is no new accepted state.

### EAS compatibility

The deployed schema is only:

```text
bytes32 baarneRecordHash
```

It cannot represent M1 events and is not reused. The compatible proposed schema is:

```text
bytes32 membershipEventId,bytes32 authorizationEnvelopeHash
```

It exposes only commitments. The full event/envelope remain portable material and must match those commitments. A future EAS decoder must verify the UID, schema, attestation data and EAS log at the exact finalized block. The implemented `decodeLog` boundary is versioned trusted adapter code; it cannot waive signature, actor-policy, or state-transition checks. No schema was registered.

## 7. Duplicate, synchronization and checkpoint behavior

- Exact repeated delivery at the same position is collapsed.
- Two different commitments at the same position fail `CONFLICTING_CHAIN_POSITION`.
- A repeated signer/nonce at a later finalized position fails `AUTHORIZATION_NONCE_REPLAY`.
- An accepted event ID replay also remains rejected by M1.
- Input delivery order is irrelevant; verified chain position is the only replay order.
- Finalized checkpoints contain the chain cursor, M1 state/state hash, signer-nonce set and a hash-chained result commitment.
- Checkpoint tampering is detected. A resumed replay equals a complete rebuild.
- A checkpoint is a local resumability artifact, not an external finality proof. An independently obtained verifier should rebuild it from Genesis and finalized history before trusting it.

## 8. Attacks and tests

The 14 Gate F tests cover:

1. chain/network/event/payload/signer/nonce binding;
2. forged signature and tampered event rejection;
3. every supported actor rule and every unsupported governance rule;
4. two independent initializations with shuffled material/RPC delivery;
5. duplicate delivery and later replay;
6. nonce reuse across different events;
7. unauthorized actor with no state mutation;
8. same-time conflicting transitions resolved by chain position;
9. pre-final reorganization isolation;
10. finalized-time protection against event backdating;
11. RPC block/log disagreement and missing logs;
12. interrupted synchronization and checkpoint rebuild;
13. wrong schema/missing portable material;
14. raw read-only JSON-RPC finalized snapshot stability.

Independent replay produced identical accepted and rejected event lists, membership state, and state hash.

## 9. Live read-only Base Sepolia check

Command:

```powershell
npm run check:m1:gate-f:finalized
```

On 2026-10-09T21:42:45.313Z, `sepolia.base.org` and `base-sepolia-rpc.publicnode.com` agreed on common finalized block **47906233**, hash `0x0b734445b4ed032ac8d86118a606e087f6fcdd9c3c73cbbd46c1f2e0e9c28a43`, timestamp **1791580754**. Their reported finalized heads differed by ordinary provider lag, so the lower common height was used and independently queried from both. This was a read-only check. It did not query or claim any M1 event because no M1 schema is deployed.

## 10. Full regression results

Commands:

```powershell
npm run test:m1:gate-f
npm run test:m1
npm test
node --test tests/admission.test.mjs tests/v0.1/core.test.mjs tests/v0.1/security.test.mjs
& '.\.tools\node-v22.23.3\node.exe' --test tests/v0.1/network.acceptance.mjs
& '.\.tools\node-v22.23.3\node.exe' --test tests/v0.1/operations/operations.test.mjs tests/v0.1/operations/documentation.test.mjs
```

Results:

- Gate F focused: **14/14 passed**.
- M1 focused security/domain: **28/28 passed**.
- Root M0/M1 suite including Gate F: **294/294 passed**, plus strict TypeScript.
- Gate 0G/V0.1 core/security: **54/54 passed**.
- Real five-process V0.1 network and Company Death: **1/1 passed**.
- V0.1 operations/documentation: **2/2 passed**.
- Non-overlapping full total: **351 passed, 0 failed, 0 skipped**.

## 11. Unresolved dependencies and risks

1. `GENESIS_CLOSED` has no accepted actor. Gate F safely blocks it, which also blocks normal post-Genesis progression until governance specifies a non-privileged authorization rule.
2. Suspension and expulsion have no accepted voting/decision authorization proof.
3. The proposed EAS schema and exact decoder are not deployed. A live M1 finality end-to-end transaction was intentionally impossible within this no-deployment/no-transaction gate.
4. RPC equality detects disagreement, lag and one-sided omission. Two colluding or common-upstream providers can present the same incomplete view. Base Sepolia consensus and data availability remain external assumptions.
5. A finalized testnet does not establish mainnet-grade production safety, permanence, censorship resistance, or economic sustainability.
6. Random nonce uniqueness is enforced by full finalized replay/checkpoint state; no monotonic signer sequence was added.
7. EVM key control is not personhood, human uniqueness, current recovery authority, or proof of truthful acquaintance.
8. Portable event/envelope material must remain available independently of EAS hash commitments.
9. Finalized checkpoint hashes protect accidental/local mutation but are not independently anchored trust roots.
10. No BFT implementation, centralized sequencing authority, token, privileged administrator, or production protocol upgrade governance was added.

## 12. Files

Created:

- `packages/membership-gate-f/package.json`
- `packages/membership-gate-f/README.md`
- `packages/membership-gate-f/src/index.mjs`
- `tests/membership-gate-f.test.mjs`
- `scripts/check-m1-gate-f-finalized.mjs`
- `docs/M1_GATE_F_REPORT.md`

Modified compatibly:

- `packages/membership-state/src/index.mjs` — optional external finalized ordering and authoritative-time adapters; defaults unchanged.
- `packages/membership-state/README.md`
- `package.json`
- `package-lock.json` — registers the new workspace; dependency versions were not deliberately changed.

Existing M0 canonical formats, M0 signatures, EAS schemas, golden vectors, deployed contracts, live chain state, and V0.1 finality semantics were not changed. M2 was not started.
