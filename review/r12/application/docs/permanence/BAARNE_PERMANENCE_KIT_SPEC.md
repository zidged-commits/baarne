# Proposed BAARNE Permanence Kit specification V0.1

2026-10-02 · **Proposal only.** This document specifies a candidate artifact set and acceptance exercise. It does not assemble/publish a kit, establish a release authority, choose a license, deploy mirrors or change current protocol rules. The name “permanence” is an objective, not an eternal-storage warranty.

## Purpose and two preservation levels

An engineer with the kit and exported public bundles should be able to interpret V1 and implement compatible verification without BAARNE, DNS, GitHub, npm, Node.js, ethers or the EAS SDK. The kit must distinguish **authenticity reconstruction** from **historical chain evidence verification** and **current lifecycle knowledge**. Preserving an algorithm does not preserve network state or guarantee that its security survives 20 years.

Level 1 is a small, self-contained, language-neutral interpretation/authenticity kit. Level 2 adds version-specific adapter definitions and public history/evidence needed for an explicit chain cutoff. Neither contains member private keys or implies knowledge of events after its cutoff. Full chain verification from first principles may require a much larger separate consensus/data archive; a JSON RPC response alone is not such an archive.

## Candidate artifact inventory

Proposed filenames below are logical kit components, not files created by this review.

| Component | Minimum contents | Existing starting point | Remaining work before a real kit claim |
| --- | --- | --- | --- |
| READ-ME-FIRST / scope manifest | Protocol/version/release ID, creation date, normative hierarchy, implemented versus proposed status, coverage/cutoff, file lengths/hashes and encodings | This review, protocol doc and gate reports | Freeze authentic release identity; resolve contradictory historical status headers; exact manifest canonicalization/suite still to specify |
| Human semantics | Exact reference statement, authorization versus truth/personhood/admission, issuer-declared time versus observation time, expiry/revocation effects | TRUST_PROTOCOL_V0.1.md | Explain absent trust-path/admission rules explicitly; do not invent them from the word “trust” |
| Formal record schema and parser profile | Nine required fields, constants/types/ranges, nulls, no extras/coercion/duplicates, raw limits, escaped-key handling, ASCII/hex normalization | Protocol tables, src/index.ts and src/json.ts | Standalone language-neutral schema/validation pseudocode; JSON Schema alone cannot recover discarded duplicates or fully enforce raw numeric lexemes |
| Canonicalization and hash specification | Exact sorted field names, byte encoding, normalization before serialization, no BOM/whitespace/newline, unsigned integer format, SHA-256 domain bytes/output encoding | Existing protocol doc + three vectors | Embed/reference preserved complete algorithm definitions; avoid reliance on a live RFC link or JS implementation behavior |
| Identity method registry snapshot | Immutable names, lengths, identifier derivation, invalid inputs, key-control meaning, supported/unsupported method handling | evm-eoa docs and verifier | Explicit public-key/address derivation, recovery details and algorithm parameters; registry release provenance/collision rules |
| Signature specification | Seven fields, exact 86-byte message, EIP-191 prefix, Keccak versus SHA3 distinction, secp256k1, r/s/v wire/low-s checks, issuer binding and error cases | Identity docs/source and authorization vectors | Independent full recovery/Keccak conformance specification and negative vectors; historical SDK invocation is insufficient |
| Verification state machine | Protocol/auth/evidence/lifecycle outcomes; precedence; unavailable versus absent; expiration comparison; observation scope | Current verifier and chain types | Consolidated normative pseudocode; bound freshness/stale behavior is unresolved; missing bundle must not become validity |
| Revocation profile | Current native EAS UID-scoped authority/behavior, relation to expiry and immutable issuance | Adapter code and tests | Live revoke evidence not yet collected; portable revoke, multi-UID/cross-chain scope and migration remain undefined |
| Golden and negative vectors | Original three protocol + two signature vectors, exact expected bytes/hashes/digests/public keys/signatures, invalid variants with expected outcomes | tests/fixtures and tests/*.mjs | Standalone negative corpus and complete language-independent recovery tests; preserve old expected bytes, never regenerate to make new code pass |
| Adapter capsule for each deployment | Chain/genesis identity, contract/registry addresses, version-specific ABI/schema derivation, resolver/revocability, native binding, transaction/receipt decoding, finality assumptions, code/proxy/upgrade provenance | EAS adapter, configuration, schema/receipts/reports | Frozen full external definitions and deployment/control evidence; current code/version RPC checks are not equivalence or consensus proofs |
| Public verification bundles | Canonical record, portable signature, all known evidence locators/observations; operational metadata separate and untrusted | Gate 0D/E public evidence and five-layer result | Versioned export/import format, completeness declaration and holder delivery; no claimed globally complete inventory |
| Historical evidence archive | Relevant native issuance/revocation events, receipts, block hashes/headers, chain-specific validation/proof material, observation cutoff/source | Saved RPC-derived receipt/state observations | Current JSON snapshots are not self-authenticating chain proofs; preserve or explicitly identify trust anchors and unavailable history |
| Checkpoint capsule, if later adopted | Event/leaf/node/root encodings, ordering, proof algorithms, conflict/fork/freshness and publisher rules | Architecture sketch only | Not implemented or specified sufficiently today; must remain marked absent in a V1 kit |
| Release provenance and rights | Content manifest, algorithm IDs, known release fingerprints, authenticated provenance, license/redistribution notices, dependency licenses where bundled | No frozen BAARNE release-signing/rights package found | Human selection/approval of provenance anchors and licenses; a newly found signature/key cannot authenticate its own origin |
| Optional source/build archive | Current source, dependency versions/integrities/licenses, toolchain/source instructions, reproducibility notes | Workspace/lockfile | No npm availability assumption; binaries/containers are conveniences, not the normative specification |

The exact existing schema UID is `0xa8390706013a892e1283a315054d3f1d04175a69178137590ec181f646b09aa4`, for `bytes32 baarneRecordHash`, zero resolver, revocable=true. Preserve the derivation and network/deployment context, not just this hex string. An identical schema identifier on another chain is not evidence of identical issuance or revocation history.

## Self-contained decoding essentials

The real kit must retain the unchanged nine-field V1 contract: expiresAt, issuedAt, issuer, metadataHash, nonce, protocolVersion, recordType, revocable, subject. Preserve all constraints in the existing specification, including safe integer maximum 9007199254740991; null-only metadataHash; revocable=true; future expiry strictly after issuance; method-tagged fixed-width identifiers; nonce's exact 32-byte encoding. Protocol serialization allows self-reference; Gate 0E's demonstration rejects same-identity A/B. This distinction must survive source loss.

Hashing remains SHA-256 over UTF-8 `BAARNE_RECORD_V1` followed by one LF and the canonical JSON bytes, producing lowercase `0x` plus 64 hex digits. Signature intent remains UTF-8 `BAARNE_REFERENCE_V1` plus one LF and the hash **as text**, totaling 86 bytes. The M0 signature digest is Keccak-256 of byte 0x19 plus ASCII `Ethereum Signed Message:` plus LF plus ASCII `86` plus that message. Neither FIPS SHA3-256 nor signing the decoded 32-byte hash is equivalent. Preserve curve parameters, key/address derivation and recovery rules instead of merely saying “use ethers.verifyMessage.” [EIP-191](https://eips.ethereum.org/EIPS/eip-191) is an external definition to preserve, not a required live resolver.

Current `evm-eoa` identifies control of a secp256k1 key, not a human, domain, DID resolver or Base account. Its address derivation must be specified as the final 20 bytes of Keccak-256 over the 64-byte uncompressed public-key coordinates, without the leading 0x04, plus the existing lowercase method-tag encoding. This is an explanatory requirement for a self-contained kit, not a new identity rule or an implementation edit. Recoverable signatures require curve/order checks and the specified low-s/v interpretation.

## Authenticity without a live official domain

A proposed release manifest can be identified by a versioned content digest and preserved with independent custodians, printed/offline fingerprints and signed release records. A domain may locate a copy but must not redefine old bytes. Different mirrors can deliver identical verified artifacts; updates use new release identities and record changes. Multiple independently acquired provenance anchors reduce sole-source substitution risk.

A digest alone authenticates content only if the expected digest was learned authentically. A signature alone proves a particular key signed it, not that this was the historical BAARNE authority. Required human decisions include the initial release provenance, signing-key scope, allowed rotation/compromise handling and how disputed forks are labeled. Do not make a founder's future availability or private key mandatory to interpret an already-preserved release. No new release/governance key is created by this review.

## Strict 2046 reconstruction exercise

Give an engineer only the proposed kit and a collection of exported records/evidence; disable official site/source/npm/RPC credentials. Permit general computing knowledge and independently obtainable network data as declared, but no original developer explanation. A future real acceptance exercise should require:

1. Decode the exact statement and field semantics; reproduce every positive hash vector and reject every negative/parser-boundary vector without running original source.
2. Reconstruct the complete signature digest and public-key/address recovery independently; distinguish mathematical authorization from live lifecycle and personhood.
3. Verify supplied current-profile evidence at a stated historical cutoff under explicitly named trust/consensus assumptions. Missing proof/data must produce unknown/unverified, not a fabricated ACTIVE result.
4. Explain a revoked, expired, never-published, wrong-chain, wrong-schema, mismatched-attester and unavailable case; do not erase historical issuance.
5. Identify which later revocations/publications could be missing. Reconstruct only the covered history, never infer global completeness from a folder or root.
6. Create a compatible new local record/signature with a new locally controlled key without contacting BAARNE. Current EAS publication/revocation additionally requires a surviving compatible network, funded key and profile.
7. Recognize unsupported future suites/identity methods, cryptographically obsolete evidence and disputed release provenance without silently falling back.

This thought experiment is **not yet passed as a full specification-only reconstruction test**. Existing .NET vectors strongly support language-independent canonical/hash checks and ECDSA verification against a committed digest, but do not independently recompute Keccak, recover v/address, implement the chain verifier, or exercise future portable revocation/checkpoint rules.

## Missing information / conditions that can prevent success

| Gap or lost artifact | Consequence in 2046 | Current conclusion |
| --- | --- | --- |
| Every record preimage or every signature copy lost; only EAS hash remains | Cannot reconstruct the endorsed record/authorization | Fundamental availability gap, not solvable by a better hash |
| No authentic kit/release fingerprint or method registry provenance | Cannot resolve a maliciously altered specification or conflicting version labels | Release authenticity/bootstrap not established |
| Canonical/parser edge rules preserved only in code | Divergent accepted inputs despite matching happy-path vectors | Consolidation and negative vectors required |
| Full crypto parameters/address recovery or external algorithm definitions absent | Can't reliably replace ethers by reading “EVM signature” alone | Self-contained algorithm capsule required |
| Native adapter ABI/schema derivation/finality/deployment provenance absent | Cannot interpret UID/native state or authenticate chain observations | Current source helps, specification-only kit insufficient |
| Historical chain data/proofs/trust anchors lost | RPC snapshots cannot prove old state independently | Historical assertion may remain unverified; do not invent a proof |
| No current chain or newer event stream available | Cannot establish no later revocation | Fresh lifecycle UNKNOWN; historical authenticity may still verify |
| No multi-publication/global revoke/migration rules | Two chains or UIDs disagree with no defined resolution | Lifecycle portability unresolved |
| No freshness/coverage/conflict/checkpoint rules | Root or log interpreted as complete/current when it is not | New profiles require explicit design, not implementation inference |
| Trust-path/admission/identity-continuity rules never defined | Cannot derive membership, human continuity or network trust from raw edges | These capabilities are not current V1 promises; must state absent |
| Lost issuer key/DPAPI environment | Cannot sign or revoke as old issuer | Verification may survive; original authority is not reconstructable from public kit |
| Cryptographic break before authenticated migration/renewal | Newly forged records may be indistinguishable from genuine old claims | No retrospective certainty from a timestamp supplied by attacker |
| Reuse/redistribution rights unspecified | Technical availability does not establish permission to republish original material | No root project LICENSE found; human/legal decision needed, no legal conclusion supplied |

The proposed kit can preserve exact interpretation and enable software replacement. It cannot manufacture missing bytes, restore lost private authority, guarantee current global knowledge, establish truth of endorsement or reverse a cryptographic break. No distribution infrastructure or recommended redesign is implemented in this review.
