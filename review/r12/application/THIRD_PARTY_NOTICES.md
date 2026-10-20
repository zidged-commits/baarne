# Third-party software and notices

BAARNE's AGPL-3.0-only / CC BY-SA 4.0 selection covers original material as
defined in `LICENSING.md`. It does not replace upstream licenses. Preserve
copyright, permission, disclaimer and attribution notices with redistributed
components. No endorsement by their authors is implied.

## Offline monument capsule

The capsule preserves the unmodified ethers 6.17.0 ESM bundle. Its upstream
source map identifies code from these four dependencies; all 24 mapped source
contents matched the installed files byte for byte during the 2026-10-16 review:

| Component | Reviewed version | Upstream terms |
| --- | --- | --- |
| ethers | 6.17.0 | MIT; Richard Moore |
| @adraffy/ens-normalize | 1.11.1 | MIT; Andrew Raffensperger |
| @noble/curves | 1.2.0 | MIT; Paul Miller |
| @noble/hashes | 1.3.2 | MIT; Paul Miller |
| aes-js | 4.0.0-beta.5 | MIT; Richard Moore |

The builder also preserves the direct-package metadata/notices for tslib 2.7.0
(0BSD, Microsoft), ws 8.21.0 (MIT) and @types/node 22.7.5 (MIT). Those three
packages do not appear in the bundle's source map; their presence in the notice
set is not a claim that their executable code runs in this capsule.

In a **new capsule**, exact installed license/notice files are under
`vendor-notices/<package>/`. `PROVENANCE.json` records selected versions and
source hashes; `CAPSULE.json` hashes the notices as well as the executable.
In the **repository**, review copies are under `docs/third-party/notices/`, with
hashes and source-map evidence under `docs/evidence/third-party-review/`.
Retain both upstream inline notices and separate license files. These upstream
texts keep their original terms and are not CC-licensed BAARNE documentation.

This dated review concerns the pinned versions above. Repeat it if dependency
bytes change. It is not an independent rebuild, a source offer for every BAARNE
dependency, legal clearance of the complete repository, or publication consent.
Historical capsule bytes and their original notices have not been rewritten.

## Source repository and other distributions

The retained CometBFT/bridge binaries' 120 module/version records now have a
bounded top-level V2 notice inventory: 141 exact copied texts under
`docs/third-party/go-notices-r2/`, mapped by module/version and hash in
`docs/evidence/release-candidate-k3-remediation/GO_NOTICES.json`.
The earlier 143-copy inventory is retained as history; two lib/pq Go programs
were falsely matched by their names and are excluded from V2.
[The correction](docs/K3_SCANNER_COMPILER_REMEDIATION_REPORT.md) and
[the Go review](docs/K3_GO_CLOSURE_REPORT.md) state the remaining nested,
runtime/image, source-delivery and security boundaries. This inventory does
not clear an executable or container for redistribution and is not a claim
that Go binaries are included in the Node-only review package.

The separate current-source bridge comparison uses 17 linked module versions
and 24 exact top-level legal-text copies under
`docs/third-party/go-notices-bridge-comparison/`, with its own mapping in
`docs/evidence/release-candidate-k3-bridge/GO_NOTICES.json`.
[Its rebuild report](docs/K3_CURRENT_BRIDGE_REMEDIATION_REPORT.md) records the
new dependency pins and the still-open runtime/source/redistribution review.
It is not adopted as a release executable and does not replace the broader
historical inventory. These legal texts retain their original upstream terms.

The separate CometBFT dependency-patch comparison maps 120 exact module versions
to 141 top-level texts in
`docs/evidence/release-candidate-k3-comet-patches/GO_NOTICES.json`. Existing exact
copies are referenced again after comparison with source bytes; only seven
texts for five newly inventoried versions were added under
`docs/third-party/go-notices-comet-patches/`.
[The node patch report](docs/K3_COMET_NODE_PATCH_REPORT.md) preserves its remaining
security and source/runtime/license limits. The comparison is not adopted or
cleared for distribution. No upstream grant is replaced by BAARNE's licenses.

The libp2p 0.50.0 node comparison has a separate 116-module, 135-text top-level
map in `docs/evidence/release-candidate-k3-libp2p/GO_NOTICES.json`.
`NESTED_LEGAL_TEXTS.json` in that directory maps 23 named-directory references
to three exact standard-text copies in `docs/third-party/go-nested-legal-texts/`.
Only newly inventoried top-level versions add copies under
`docs/third-party/go-notices-libp2p/`; older exact-version copies are reused.
[The scoped report](docs/K3_LIBP2P_REMEDIATION_REPORT.md) states the remaining
embedded/header, runtime and source-delivery review. This is a text inventory,
not legal clearance, a release or a change to any upstream grant.

`package-lock.json` records dependencies to obtain from their upstreams;
`node_modules` is excluded from the GitHub candidate. Original BAARNE imports
do not silently relicense the imported packages. A binary, container, browser
bundle or dependency-inclusive archive has a different redistribution scope
and needs its own complete notices and source-delivery review.

The lock includes GPL-3.0, MPL-2.0, Apache-2.0 and permissive packages. Exact
versions, package paths, installed notice hashes and known gaps are in the
[review](docs/THIRD_PARTY_REVIEW_REPORT.md). The repository notice set is
bounded to the capsule packages, two legacy-metadata exceptions and the
120-module Go top-level inventory described above; it is not a complete notice
bundle for redistributing all npm packages, Go,
CometBFT, Python, Node.js, Docker images or GitHub Actions.

Do not distribute dependency-inclusive artifacts on the strength of this file
alone. Keep upstream terms, supply required corresponding source and build
instructions for covered combinations, and separately review non-npm assets,
quotations and historical archives. No hosted service or release is started here.
