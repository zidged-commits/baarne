# BAARNE: local synthetic monument capsule V1

This is an unpublished preservation rehearsal, not a release, a new constitution,
a complete permanence kit, a live network or an authorization to restart one.
It preserves a readable idea and an executable example of the existing rules.
Core Pilot remains NO-GO. No private profiles, chats or key material belong here.

## Read without running software

Start with `documents/docs/governance/BAARNE_MANIFESTO.md`, then the preserved
constitution summary and membership-state README. These are dated snapshots;
historical implementation/status statements are not current readiness claims.
The reference protocol and Gate F/H reports explain the signed records and
synthetic ordering/archive assumptions. The related-work research supplies
context. All filenames and bytes are committed by `CAPSULE.json`.

REFERENCE is historical testimony, not a safety or truth guarantee. Membership
does not prove one unique human. Discovery and bilateral introduction remain
separate from membership. This capsule only executes the synthetic M1 replay;
it does not preserve the entire living product or the CometBFT operator network.

## Verify with an already available runtime

Use Node.js >=22.20.0 and <25, with native TypeScript stripping enabled (default
on the tested 22.20/24 runtimes). No npm install, GitHub, BAARNE site, RPC, wallet,
Docker or package download is needed **at verification time**. Node and the OS
are external prerequisites; no runtime binary is included.

1. Obtain the SHA-256 of `verify.mjs` and `CAPSULE.json` through a separately
   trusted channel. Check the runner hash with an already trusted hash tool
   before executing it. A runner cannot authenticate its own replacement.
2. Run `node verify.mjs TRUSTED_CAPSULE_SHA256` from this directory.
3. Expect `OFFLINE_MONUMENT_SYNTHETIC_VERIFIED` and an exact match to
   `EXPECTED_REPLAY.json` (10 accepted events and 3 expected rejections).

Keep both external fingerprints outside the capsule. Its own manifest is not a
release signature or proof of origin. An attacker who replaces the bootstrap
or the trusted fingerprints defeats this check. Verify an immutable/private
copy; hostile concurrent filesystem mutation is outside this rehearsal.

The bootstrap checks file inventory, empty extra directories, links, bounds and
every SHA-256 before loading the preserved source. The original BAARNE source
bytes are unchanged. The installed ethers self-contained ESM distribution is
preserved with package metadata and license notices; a small local package
wrapper selects that upstream bundle. This is the same BAARNE implementation,
not an independently written verifier. See `PROVENANCE.json` for exact hashes.

## Scope and limits

The `history` directory is synthetic. Its chain ID, provider observations,
signatures and finality inputs are fixtures, not live chain/consensus proofs.
A valid prefix is not proof of the latest history or absence of later events.
Hashes do not store missing data. Copies, readable encodings, a future runtime
and surviving cryptographic assumptions remain necessary.

The existing permanence-kit specification is included as a **proposal**. This
capsule does not pass its broader language-neutral reconstruction requirements:
the same JavaScript source and crypto library are still used. Live quorum,
independent operators, legal/privacy/security approval, indefinite availability
and authority to revive a stopped network are not established.

The owner selected AGPL-3.0-only for original BAARNE software and CC BY-SA 4.0 for
the original manifesto/documentation on 2026-10-16. Read `LICENSING.md`, `LICENSE`
and `LICENSES/CC-BY-SA-4.0.txt` in new capsule builds. Third-party notices retain
their own effect; the whole artifact/data container is not blindly relicensed.
`THIRD_PARTY_NOTICES.md` identifies the reviewed bundle components; exact
upstream license/copyright files are in `vendor-notices/` in new builds.
Historical capsules keep their original bytes and creation-time licensing
metadata. Public redistribution review, release authority/fingerprints and
long-term mirror arrangements remain pending. No publication is performed here.
