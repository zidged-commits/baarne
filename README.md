# BAARNE

BAARNE explores voluntary, user-controlled profiles, explainable reciprocal
opportunities and introductions requiring both people's consent. Public
reference history, membership authority and private introductions are separate.
No introduction automatically creates a membership reference.

**Status: source-review candidate r12. Core Pilot NO-GO.**

The finite K1–K8 local technical/review checklist is complete. This is not an
approved production deployment, independent security audit, legal clearance or
real-user trial. Independent security/privacy/legal review, actual operator and
Genesis/key decisions, and explicit pilot approval remain open (C1–C4).

## Start the review

[Independent review request](REVIEW_REQUEST.md) · [Contribution guide](CONTRIBUTING.md) · [Private security reporting](SECURITY.md) · [Discussions](https://github.com/zidged-commits/Baarne/discussions)

- [Application sources and selected vendored dependencies](review/r12/application/)
- [Run and inspect the isolated candidate](review/r12/README.md)
- [Operator runbook and closed defaults](review/r12/application/docs/release/OPERATOR_RUNBOOK.md)
- [External review questions](review/r12/EXTERNAL_REVIEW.md)
- [A1–A8 acceptance matrix and limits](review/r12/ACCEPTANCE_A1_A8.json)
- [Digital monument / offline synthetic replay](review/r12/monument/)
- [Exact delivery manifest](review/r12/MANIFEST.json)
- [Companion runtime/build-kit requirements](review/r12/COMPANION_KIT.json)
- [Explicit publication exclusions](review/r12/PUBLICATION_EXCLUSIONS.json)

The byte-exact reviewed delivery is under review/r12. Its included README and
evidence describe the pre-publication preparation state; this repository root
is the publication entry. Source/capsule hashes remain unchanged.

The selected Windows Hub requires Node24.22.0; production and other platforms
are not approved. No npm install is needed for the selected source package.
The separately pinned binary/runtime kit and its complete source obligations
are not bundled here; do not assume a companion binary download is available.
Use only fresh synthetic directories; never upload generated provider/owner
keys or private data. Read the linked operator and runtime documents first.

The offline capsule preserves a synthetic M1 fixture (10 accepted /3 expected
rejections). It is not a running V3 chain, an independent verifier implementation
or evidence of permanent storage. Existing exact runtime/consensus tests and
their reuse boundaries are described in the acceptance matrix.

## Scope and cost

The design targets participation without mandatory user gas/token purchases.
Operating hardware, storage and hosting still consumes resources. Four nodes
under one account are not four independent operators; synthetic tests do not
establish human uniqueness or replace qualified review.

Frozen M1 semantics remain preserved. Versioned synthetic CometBFT execution
is separate; M2 voting/sanctions are excluded from this candidate. An active
network service needs security/runtime maintenance; this project does not
promise perpetual safety without updates.

## Integrity and licensing

Delivery MANIFEST.json SHA256:
e6287e4247f1d6168ef7878c7921b266db540d8fb8f35e9311577d2d1760cd62

Application REVIEW_MANIFEST.json SHA256:
e7268ac7e4b1df8c46f23c88822468e316dccf53979ea077bed78218d4a48f95

Obtain expected hashes through an independently trusted channel; a manifest
cannot authenticate its own replacement or confer release authority.

Original software: [AGPL-3.0-only](LICENSE). Original documentation/manifests:
[CC BY-SA4.0](LICENSES/CC-BY-SA-4.0.txt). See [scope](LICENSING.md) and the
[preserved third-party notices](review/r12/application/THIRD_PARTY_NOTICES.md).
Upstream code, data and trademarks are not globally relicensed as BAARNE.

This repository publishes the BAARNE r12 source-review candidate.
GitHub source publication does not launch a service or authorize a live pilot.
