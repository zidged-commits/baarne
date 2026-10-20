# Selected engineering distribution: source and upstream obligations

Date: 2026-10-18. Applies only to the pinned local K3 engineering kit and its
manifest, not the entire research repository, a public release or a service.
Original BAARNE software: AGPL-3.0-only; original prose: CC BY-SA 4.0.
Upstream grants, copyright and patent notices remain unchanged. C1/C2 expert
security/privacy/legal review and C3/C4 live decisions remain open.

## What is supplied

- `node-review/`: the selected 84-source snapshot, its explicitly selected
  ethers ESM bundle and TypeScript parser, source maps and upstream notices.
  `source-metadata` is historical metadata, never an install manifest. No npm
  installation, Hardhat, voting research executable or install hook is needed.
- `bin/`: the remediated CometBFT and current-source bridge Linux/amd64
  executables plus the selected offline certificate verifier. `bridge/` supplies
  all three original bridge files; `verifier/` supplies verify-offline.go;
  all three target directories supply exact go.mod/go.sum build inputs.
- `source-modules/`: complete, unmodified source ZIPs for the union of actual
  versioned binary modules, with content-derived Go h1 validation, plus the
  explicitly marked old STUN parent-module namespace lookup source. Go needs
  that archive to establish that it does not also contain a `/v3/` package.
  No old STUN package is imported or linked; its known unsafe parser is not
  fixed or cleared. This source-only lookup must not be executed or used as a
  dependency for another target. This retains
  every source header, generated source, nested notice and license exception,
  including terms in files without a LICENSE-like name. Whole-source retention
  is used instead of guessing a license from a package metadata field.
- `legal/`: separate copies of all LICENSE/LICENCE/COPYING/COPYRIGHT/NOTICE/
  PATENTS-named text entries from those exact ZIPs, mapped to module/version/path.
  Program files such as notice.go remain source, not legal-text copies.
  Original headers also remain inside the full ZIPs. Every module has a root
  license text. A named-file inventory is not a claim that all files share the
  root license. SPDX occurrences are retained as evidence, not an exhaustive
  license classifier or replacement grant.
- `toolchain/`: the verified official Go 1.27.2 SDK archive, containing its
  full supplied sources and legal texts. Go LICENSE/PATENTS are also readable
  under `legal/go-toolchain`. The SDK is a separate general-purpose build tool.
- `runtime/`: only official Node 24.22.0 executables and their complete upstream
  LICENSE for Linux/amd64 and Windows/x64; no bundled npm executable tree or
  installer. `runtime-source/` supplies the checksum-verified official complete
  Node source archive, including upstream dependencies' preserved notices.
- `module-metadata/`: checksum-verified .mod build-list metadata. An unused
  inherited requirement or source archive is not an executable import. The
  actual executable inventory, not every line of go.sum, defines runtime scope.

## Obligations and how this delivery meets them

| Terms observed in supplied sources | Technical delivery treatment |
| --- | --- |
| Original AGPL-3.0-only software | Supply the selected original sources, license, build inputs and scripts alongside the local binaries. Preserve changes/provenance. No restrictive downstream EULA or rights claim over upstream code is added. For a future modified network service, the source access mechanism required by AGPL section 13 must be present before launch. The local kit is not a deployed network service. |
| Apache-2.0 | Supply original LICENSE and NOTICE/attribution files, unchanged sources and provenance. State dependency pin changes in build records; no upstream source was patched. Do not claim trademark rights or author endorsement. |
| MIT, BSD, ISC, 0BSD and comparable permissive notices | Preserve the complete copyright, permission/conditions and disclaimer with source and executable delivery documentation, including bundled ethers and TypeScript notices. |
| MPL-2.0 file-level code (including hashicorp sources) | Supply the full exact module source ZIPs, preserving file terms and headers; identify source locations in ENGINEERING.json. There is no reliance on a future, expiring source offer or on relicensing covered files as BAARNE code. |
| Alternative-license expressions / CC0-marked helper code | Keep the complete upstream alternatives, original text and file-level markers; do not strip an alternative or invent a global relicensing decision. Full unchanged source is supplied. |
| Go runtime/SDK and embedded Node dependencies | Supply original complete notices and full official source distributions as above. The Node LICENSE's component-specific terms remain intact. |
| Original CC BY-SA 4.0 documentation | Retain author/project attribution, license link/text and source context. Third-party legal texts are excluded from this grant by LICENSING.md. |

MPL notices and source access requirements are described in the
[MPL 2.0 text](https://www.mozilla.org/en-US/MPL/2.0/), Apache preservation in
[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), and original-code
obligations in the repository's unmodified AGPL license. Go content hash
verification follows the [Go module authentication model](https://go.dev/ref/mod#authenticating).
This is a technical preservation/compliance record, not a lawyer's opinion on
future service/data processing or a blanket rights clearance for the repository.

## Build and source access

Obtain the manifest SHA-256 through a separate trusted channel; a replaced
manifest cannot authenticate itself. With this reviewed script and an existing
separately supplied Linux/amd64 Docker build environment, run:

```text
python scripts/rebuild-v1-engineering-kit.py --kit NEW_KIT_PATH --manifest-sha256 EXTERNAL_PIN --work SEPARATE_NEW_BUILD_PATH
```

The script refuses an existing output, checks the exact file set and every
byte/hash, verifies module h1 from ZIP contents, builds from an initially empty
cache with network disabled, and requires byte-identical executable hashes.
No validator or public application endpoint is launched. The original Node
review README describes its earlier 24.19.0 baseline; ENGINEERING.json and the
K3 closing report identify the newly selected and tested 24.22.0 runtime.

Docker/its Debian base image, host Python, operating system and all unrelated
research dependencies are **not redistributed by this kit**. The existing
builder image is an external general-purpose environment, pinned by actual
RepoDigest. CGO is disabled, so these Go executables do not acquire a dynamic
glibc linkage from that image. K6 still owns clean-machine operator setup;
K7 owns integrated acceptance. No clean-machine, independent build or operator
claim follows from a same-host fresh-cache rebuild.

## Reopening conditions

Changing source, runtime, module pins, bundled bytes or distribution scope
invalidates this exact technical inventory and requires the affected review.
Supplying a container, whole node_modules tree, unrelated binary asset, modified
upstream file or a public network service requires its own relevant obligations.
Historical unsafe binaries and held private artifacts are not kit inputs.
Publishing, pushing, deploying or moving real personal data remains separately
authorized; this document performs none of them.
