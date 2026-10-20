# baarne r12 — request for independent review

baarne explores a framework for voluntary private profiles, explainable
reciprocal opportunities and introductions requiring both people's consent.
Public historical references, membership authority and private discovery/
introduction graphs remain separate. Introduction never automatically creates
a membership reference.

The goal is participation without a mandatory token/gas payment. Hardware,
storage and hosting still consume resources; sustainable independent operation
is an open question. A preserved digital monument and an active online service
have different maintenance and availability requirements.

**This is an AI-assisted synthetic engineering candidate, not a live pilot or
an independently audited production system. Core Pilot NO-GO.** We are asking
for precise criticism and reproducible findings, not certification by popularity.

## Start here

| Review area | Entry | Main question |
| --- | --- | --- |
| Membership/finality/history | [V3 execution](review/r12/application/experiments/cometbft-fee-free-lab/lifecycle-v3.mjs), [acceptance matrix](review/r12/ACCEPTANCE_A1_A8.json) | Are actor/network/epoch and result/header bindings complete? What hidden operator trust remains? |
| Private consent/disclosure | [Hub adapter](review/r12/application/apps/hub/private-server.mjs), [vault](review/r12/application/experiments/cometbft-fee-free-lab/private-vault.mjs), [pair state](review/r12/application/experiments/cometbft-fee-free-lab/private-introduction.mjs) | Can stale authority, withdrawal, handoff or restart disclose a field without current permission? |
| Operations/recovery | [runbook](review/r12/application/docs/release/OPERATOR_RUNBOOK.md), [checkpoint](review/r12/application/apps/hub/operator-checkpoint.mjs) | Are explicit pins, unknown-tail refusal, storage halt and key-loss limits correctly bounded? |
| Preservation | [capsule](review/r12/monument/), [distribution obligations](review/r12/DISTRIBUTION_OBLIGATIONS.md) | Which availability, toolchain, authenticity and maintenance dependencies remain? |

[Run a bounded source check](CONTRIBUTING.md). The [full review brief](review/r12/EXTERNAL_REVIEW.md)
and [manifest](review/r12/MANIFEST.json) define the selected scope. Review source
aggregate: d598c9dedf00ec989af3e3a0c38f152ef4476f89a92fec24c1375d2ebfcd65dc.
Historical pre-publication wording inside the pinned package is preserved; the
repository root documents describe the currently available public review channels.

## What remains open

- C1: actual independent security review; AI-generated tests are not that review.
- C2: qualified privacy/legal assessment of intended use, roles, consent, retention
  and immutable public history. No legal conclusion is claimed by this request.
- C3: actual independent operators, Genesis/authority, trusted pin distribution,
  key custody and incident responsibility. Four same-account VMs are not four
  independent volunteers. Windows DPAPI lab recovery is not production custody.
- C4: explicit bounded pilot permission and consenting field evaluation after
  the applicable reviews/decisions. No real-user deployment is authorized here.

Stable identities do not prove one-human uniqueness. M2 voting/sanctions and
automatic migration of frozen historical identities are outside this candidate.
The offline M1 fixture's10 accepted/3 expected rejected events are not the V3
network's history. A valid historical prefix does not prove latest-state freshness.

## Respond

Use [Discussions](https://github.com/zidged-commits/baarne/discussions) for public
questions and design criticism, or [a structured issue](https://github.com/zidged-commits/baarne/issues/new/choose)
for a concrete non-sensitive finding. Please identify scope, evidence, assumptions,
impact and the smallest reproduction. A narrower accurate review is useful.
Use [the private reporting route](SECURITY.md) for vulnerabilities or private data.
No bounty, paid role or response-time commitment has been established.
