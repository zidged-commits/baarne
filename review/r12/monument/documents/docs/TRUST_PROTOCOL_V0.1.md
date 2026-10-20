# BAARNE Trust Protocol v0.1

Status: Gate 0B canonical format remains unchanged and frozen by three golden vectors. Gate 0C local authorization is implemented in `packages/identity`; local signatures have been produced and independently verified. No blockchain transactions have been produced. The protocol package remains free of Ethereum dependencies.

BAARNE_REFERENCE_V1 means: **I know this person and I vouch for their admission to the BAARNE network.**

It does not guarantee future behavior, transfer legal responsibility, or grant permanent membership. It is revocable, and the network's record of issuance remains after revocation.

## Serialization decision and portability

Evaluated Ethereum ABI encoding, a custom fixed-key JSON order, and RFC 8785 JSON Canonicalization Scheme (JCS). ABI adds unnecessary Solidity types/encoding assumptions. A custom JSON order is portable but introduces a bespoke convention. Use JCS ordering on the validated, normalized, deliberately restricted record instead: UTF-8 JSON; lexicographically sorted property names; no whitespace, BOM or trailing newline.

This explicitly supersedes Gate 0A's proposed key order before any record was published. Domain separation and SHA-256 remain unchanged. The encoder implements JCS for this schema, not arbitrary nested JSON. All accepted strings are ASCII constants/cryptographic identifiers/hex; all numbers are nonnegative safe integers, avoiding Unicode normalization and floating-point representation ambiguities. Protocol normalization (hex letter case) occurs BEFORE JCS serialization; JCS itself does not alter string values. Source: https://www.rfc-editor.org/rfc/rfc8785

## Exact public record

All nine fields are required; no extra fields, defaults, coercion or nested values:

| Field (canonical order) | Type and constraint |
| --- | --- |
| expiresAt | null, or safe-integer Unix seconds strictly greater than issuedAt |
| issuedAt | integer Unix seconds, 0 through 9007199254740991; negative zero rejected |
| issuer | method-tagged public cryptographic identifier described below |
| metadataHash | null only for M0 |
| nonce | lowercase `0x` plus 64 hex digits (32 bytes) |
| protocolVersion | literal string `0.1` |
| recordType | literal string `BAARNE_REFERENCE_V1` |
| revocable | literal boolean true |
| subject | method-tagged public cryptographic identifier described below |

Valid test vector's exact canonical JSON, one line with no trailing newline:

```json
{"expiresAt":null,"issuedAt":1700000000,"issuer":"evm-eoa:0x1111111111111111111111111111111111111111","metadataHash":null,"nonce":"0xabababababababababababababababababababababababababababababababab","protocolVersion":"0.1","recordType":"BAARNE_REFERENCE_V1","revocable":true,"subject":"evm-eoa:0x2222222222222222222222222222222222222222"}
```

These addresses and repeated nonce are synthetic test data. Issuance must generate a fresh cryptographically random nonce; Gate 0B validates its shape, not its randomness. issuedAt is the issuer's assertion, not block time; validation does not consult a clock or infer current validity/expiry. Self-reference is not prohibited at the serialization layer. Hash equality does not imply membership or personhood.

## Hash algorithm

```text
canonicalBytes = UTF8(canonicalJSON)
baarneRecordHash = "0x" + lowercaseHex(
    SHA-256(UTF8("BAARNE_RECORD_V1\n") || canonicalBytes)
)
```

`\n` is one LF byte (0x0a). There is no NUL terminator. SHA-256 is used, not Keccak-256 or an Ethereum message hash. Baseline expected hash:

```text
0xff9279b302bc3eeb0a0db04d82a057e4338bc8d2d5910d810215ea84b5c36372
```

Hashing uses standard Web Crypto available in Node/browser runtimes; no EAS, ethers, RPC, database, time or randomness dependency. Three committed vectors cover null expiry, finite expiry and integer boundaries, independently generated using PowerShell/.NET and checked against the TypeScript implementation and Node crypto.

## Identity identifier format and method registration

```text
<method>:0x<public-identifier-bytes-as-lowercase-hex>
method = [a-z][a-z0-9-]{0,31}
```

Only fixed-width cryptographic public identifiers are allowed, never names, email addresses, URLs or chain-qualified account IDs. Hex digits may arrive uppercase but normalize to lowercase; the method name and `0x` prefix must already be lowercase. All-zero identifiers are rejected.

M0's registered method is `evm-eoa`, exactly 20 bytes. It names an EOA cryptographic identifier, not a Base account or chain. Parsing does not prove control or perform EIP-55 checksum verification. Identity strings are not DIDs and do not imply a DID resolver.

`createReferenceCodec(additionalMethods)` permits trusted code to register other immutable method names with fixed byte lengths (1–128 bytes), e.g. a future public-key identifier or digest. The registry snapshots configuration; names cannot override `evm-eoa` or each other. Unknown methods fail closed. Registration is NOT accepted from a record, HTTP input or database row. A test-only 32-byte method proves the codec is not EVM-specific; it is not a supported production identity/signing system.

Before enabling a new production method, document its byte semantics, method-specific validity rules and matching signature verifier, and add shared vectors. Never redefine an existing method; use a new name for different semantics. Existing records retain identical bytes and hashes across registry extensions. More complex identifier encodings require a separately versioned protocol extension. Future smart accounts must not be mislabeled as `evm-eoa`; their chain-dependent validation/recovery needs explicit treatment.

## Separate layers and import boundaries

`ReferenceEnvelope` has distinct `record`, optional `issuerSignature`, optional `blockchainEvidence[]`, and optional `operationalMetadata`. Only `hashReference(envelope.record)` is valid. Passing the entire envelope, evidence fields or database fields into the public record is an error, never silent field removal. The returned validated record is an immutable copy.

Evidence types carry adapter/network/attestation ID and optional transaction/block/RPC observations. Operational metadata can carry database ID/index time/platform status. Neither is authenticated by the record hash; their authenticity needs separate verification. Envelope types are separation contracts, not runtime evidence validators.

Raw input MUST enter through `parseReferenceJson`, not an ordinary JSON parser that loses duplicate keys. It accepts only a flat scalar object up to 4096 UTF-8 bytes, catches duplicate keys even with escaped names, and requires unsigned decimal integer tokens (no exponent/fraction notation, leading zeroes or negative zero). Programmatic object input rejects accessors, symbols, hidden properties, custom prototypes and extra fields. Do not pass executable objects/proxies from untrusted JavaScript; the safe external boundary is raw JSON.

Database adapters must explicitly reconstruct this logical record: restore integer seconds losslessly and preserve null/hex semantics. SQL timestamps, numeric strings, row IDs and ORM objects are not canonical inputs. A changed storage layout, JSON property order or metadata must not alter the reconstructed record. Protocol field changes intentionally change the hash. Raw duplicate information cannot be recovered after an upstream parser has discarded it.

## Portable signature envelope — Gate 0C

`PortableIssuerSignature` now has exactly seven required string fields. This finalizes the earlier four-field signature sketch; it does not modify the canonical record, its hash or the Gate 0B message:

```json
{
  "signatureType": "BAARNE_SIGNATURE_V1",
  "signatureVersion": "1",
  "identityMethod": "evm-eoa",
  "signatureMethod": "eip191-personal-sign-v1",
  "signer": "evm-eoa:0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
  "recordHash": "0xcb38b455b351c57272e89f442598c824f945f28bd4bdf9f211d19ea4819470f9",
  "signature": "0x395f335ba43a1b455a0fc7c9b21227b5b63daf4591bc59c162ce63c67bd8c1273f449659b5faf07269bbd3f3dbe2a7b33edcc17e82028614a19499344330035f1c"
}
```

This is a TEST ONLY vector, not a funded account. The discriminator makes envelope type explicit. No chain ID, transaction, RPC, EAS UID or database ID is permitted. Unknown/extra/missing fields, accessors, symbols and custom prototypes are rejected. Envelope property order does not matter; the envelope itself is not the canonical record and is not hashed as that record.

identityMethod uses the protocol method-name grammar; signatureMethod uses `[a-z][a-z0-9-]{0,63}`. Signer and recordHash must be canonical lowercase hex forms. The signature is a method-specific string (1–16384 characters); the M0 adapter requires exactly `0x` plus 130 lowercase hex digits. Future methods can define another string encoding of their cryptographic proof without assuming ECDSA. No future method is enabled by this generic storage capability.

Use `parseSignatureEnvelopeJson` / `verifyAuthorizationJson` for raw imports. Signature JSON is a flat string object bounded to 32768 UTF-8 bytes; duplicate keys, including escaped aliases, and trailing/nested content are rejected. As with records, do not pre-parse through middleware that discards duplicate keys.

## Exact signed bytes and domain review

`portableSignatureMessage(record)` is preserved unchanged. It returns UTF-8 bytes of the literal ASCII text:

```text
BAARNE_REFERENCE_V1
0x<64 lowercase hexadecimal digits of baarneRecordHash>
```

There is ONE LF after `V1`, no BOM, NUL or trailing newline. The message is always **86 bytes**. The hash is signed as text including `0x`, never decoded to 32 binary bytes. The first vector signs exactly:

```text
BAARNE_REFERENCE_V1
0xcb38b455b351c57272e89f442598c824f945f28bd4bdf9f211d19ea4819470f9
```

The corresponding EIP-191 digest is `0x14db681af0e197b4d2878b1736c673e1bed1d417c58b7a04b7a0234dfe0a9aca`.

Domain decision: retain the existing message. It names the reference type/version, and the committed record also contains protocolVersion and recordType under the separate `BAARNE_RECORD_V1\n` hash domain. No cryptographic flaw requiring a Gate 0B change was identified. M0's envelope type/version and identity/signature pair are fixed, checked dispatch constraints, not separate signed fields. Signer and recordHash are cryptographically cross-checked. No other BAARNE action (login, transaction, revocation, membership, migration approval) may accept this reference-intent message. A future change in authorization semantics MUST define a new signed domain/suite; merely changing envelope labels is insufficient. No automatic algorithm fallback or metadata-selected plugin loading.

## M0 EIP-191 method

EIP-191 is the signature mechanism of `evm-eoa`, NOT the universal BAARNE protocol signature format. Pinned ethers 6.17.0 signs/verifies the message as a string. For this message length:

```text
digest = Keccak-256(UTF8("\x19Ethereum Signed Message:\n86") || UTF8(message))
signature = secp256k1 ECDSA(digest)
wire = 0x || r[32 bytes] || s[32 bytes] || v[1 byte]
```

The initial `\x19` is one byte. This is EIP-191 version 0x45 personal signing. Hashing the BAARNE record remains SHA-256; only the identity adapter uses Ethereum's Keccak framing. Require 1 <= r < curve order, 1 <= s <= order/2 and v = 27 or 28. Reject high-s, zero/out-of-range scalars, nonstandard recovery IDs and 64-byte compact encodings. The provider normalizes signature hex to lowercase before returning it. Address recovery is compared to the envelope signer AND the record issuer. Sources: https://eips.ethereum.org/EIPS/eip-191 and https://docs.ethers.org/v6/api/hashing/

## Verification procedure and outcomes

1. Snapshot and validate the envelope shape/type/version. Failure: MALFORMED.
2. Select a registered identity method and signature suite. Fail closed with UNSUPPORTED_IDENTITY_METHOD or UNSUPPORTED_SIGNATURE_METHOD.
3. Validate/snapshot the record with the protocol codec; reject unknown identity methods or malformed records. Check signer identifier method/width/nonzero value.
4. Recompute the canonical hash; mismatch with envelope: RECORD_HASH_MISMATCH.
5. Match envelope signer to canonical issuer; mismatch: SIGNER_MISMATCH.
6. Reconstruct the exact signing message and run the selected method verifier. M0 validates encoding/scalars and recovers the address. Unrecoverable/invalid cryptography: INVALID_SIGNATURE. Recoverable but wrong account: SIGNER_MISMATCH. Otherwise: VALID.

When multiple defects exist, earlier checks take precedence. A changed record normally returns RECORD_HASH_MISMATCH; an attacker updating that hash still fails signature verification. Diagnostics are static state codes and do not echo signatures, secret exceptions or arbitrary inputs. Scheme plugins return method verification states; they are not required to implement ECDSA recovery.

VALID means **issuer authorization for this exact logical record only**. It does not establish current non-expiration, truth of the endorsement, on-chain publication, non-revocation or platform membership. An expired record can retain a valid historical signature. Chain verification will separately evaluate lifecycle state.

## Method registry stability and future identities

Gate 0B's identifier codec is unchanged. The identity package combines its registered method/width definitions with a separate map keyed by `(identityMethod, signatureMethod)`. Built-in evm-eoa and its suite cannot be overridden; duplicate definitions fail. Registry definitions/functions are snapshotted, with no API for replacing an existing entry. Extending the registry does not change existing record hashes or built-in verification behavior. Plugin implementations remain trusted code and must not change semantics through mutable state.

`evm-eoa` permanently means the 20-byte identifier for control of the corresponding secp256k1 private key. New identity semantics require a new method name (version suffix recommended, e.g. a future `...-v1`) and new reviewed verification vectors. Syntax registration alone never enables authorization verification. Offline proof of key possession cannot determine whether an address has code on any particular chain.

Future passkeys/WebAuthn will need a registered key identifier and validation of the challenge binding to these reference-intent bytes, credential algorithm, origin/RP ID and authenticator policy. Their proof can be encoded by a method-specific signature string; that does not implement WebAuthn now. Smart-account verification may use ERC-1271 and contract state rather than recovery; it needs an explicitly defined method, state/block context and migration/recovery policy. It must not claim offline validity when required state is unavailable. Any cryptographically necessary network context must be explicitly designed into that future method's proof; none is needed or included for M0. Source: https://eips.ethereum.org/EIPS/eip-1271

## Golden vectors

The three Gate 0B canonical vectors are unchanged. `tests/fixtures/authorization-v1.json` adds two TEST ONLY authorization vectors (null expiry and finite expiry), with canonical bytes, hash, exact message/hex, EIP-191 digest, public key and signature. Fixture generation bypasses the production codec/provider using direct ethers signing and Node SHA-256. Only test code uses trivial public test scalars 1/2; never fund or reuse them.

Node tests verify hashes, message framing, address recovery and deterministic signatures. Independent .NET checks reserialize/hash the records, check message bytes, verify ECDSA r/s against the committed public key/digest, and reject a changed digest. The .NET check does not recompute Keccak or validate the recovery byte; the Node tests cover those steps. These checks do not represent an independent security audit.

Portable signatures prove issuer intent, not current non-revocation, on-chain inclusion, human identity or truthful endorsement. They are intentionally chain-neutral and may be copied. Network-specific writes/revocations still require issuer transaction authorization; future migration must carry revocation evidence and deduplicate record hashes. No chain-ID omission from an actual EAS transaction is proposed.

## Gate 0D evidence binding (no protocol change)

EAS commits only `baarneRecordHash`; record, portable signature, blockchain evidence and operational data stay separate. `BAARNE_CHAIN_EVIDENCE_V1` carries networkNamespace/reference, schemaReference, attestationReference, transactionReference (null when direct state reads do not reveal it), observation block number/hash, recordHash, observedAt, native issuer/subject, lifecycle timestamps, revocability and lifecycle. Observation block is NOT asserted to be the issuance block.

Verification reports protocol validity, portable issuer authorization, evidence match and revocation/expiry independently. Match requires the expected schema, exact 32-byte data, native attester/recipient/expiration/revocability bindings and record hash. It never treats a successful EAS read as portable authorization. `FOUND` reports retrieval and `ACTIVE` is lifecycle only; neither independently grants membership or proves the human statement. A holder supplies the off-chain record/signature to establish its meaning without the BAARNE database.

The finalized Base Sepolia schema UID is `0xa8390706013a892e1283a315054d3f1d04175a69178137590ec181f646b09aa4`, registered with zero resolver and revocable=true. This is an adapter deployment reference, not an additional canonical record field or signature domain. Registration and publication receipts belong to the evidence layer; fee reports, test output and local journals are operational metadata. Exact live evidence is recorded in [the Gate 0D report](GATE_0D_REPORT.md).

## Gate 0E issuance composition (no protocol change)

The issuance result wraps `canonicalRecord`, `recordHash`, `portableAuthorization`, `chainEvidence` and `operationalMetadata`. These are workflow output fields, not new canonical fields or a new protocol version. Canonicalization, SHA-256 domain, method-tagged identifiers, signature bytes and golden vectors remain unchanged. Blockchain identifiers stay in evidence; the attempt UUID and mutable status stay in operational metadata. Validate and hash the record alone.

The local demonstration selects two distinct test identities, fixes a fresh random nonce once, signs the exact reviewed record and verifies the signature before publication. Its same-attempt retry never regenerates the nonce. Deliberate `new` creates a separate reference and authorization; this does not define future global duplicate/admission policy. A confirmed issuance is a dated network observation, not proof of human identity, future behavior or permanent ACTIVE state.


## Gate 0F interpretation and verification clarification — 2026-10-02

REFERENCE = HISTORICAL ADMISSION ATTESTATION. The approved human explanation is “I genuinely know this person and I vouch for their admission to the BAARNE network.” This clarifies historical acquaintance/admission support; it does not add a signed text field or change existing V1 bytes, canonicalization, hashes, identity definitions or signature envelopes. Existing versioned statement text remains preserved. Verification authenticates the key's assertion, not factual acquaintance, free human intent, current membership/trust or future safety.

The [portable bundle](VERIFICATION_BUNDLE_V1.md) wraps existing artifacts; [Gate 0F](GATE_0F_REPORT.md) implements standalone offline verification and separately requested evidence checks. Historical reports' ACTIVE/REVOKED terminology is native EAS lifecycle at an observation, not an overall human-trust judgment. Actually signed expiry remains visible and unchanged. No renewal obligation or new invalidation authority is introduced.
