# Contributing a bounded review

Thank you for reviewing BAARNE. The immediate request is independent assessment
of the existing r12 candidate. The finite K1–K8 implementation list is complete;
new social features, a new consensus design and production policy changes are
outside this review. Concrete security, consent or data-loss findings can reopen
an existing item. Core Pilot remains NO-GO.

## Choose a channel

- [Private security reports](SECURITY.md): vulnerabilities, exploitation or privacy leakage.
- [Technical findings](https://github.com/zidged-commits/Baarne/issues/new/choose): reproducible, non-sensitive defects and specific trust-boundary findings.
- [Discussions](https://github.com/zidged-commits/Baarne/discussions): questions, design feedback, cost/operations assumptions and general ideas.
- [Review request](REVIEW_REQUEST.md): components, evidence and unanswered questions.

## Source and reproducibility

The exact source/capsule delivery is under review/r12. Its manifest remains
byte-exact; root documentation and .github feedback forms are outside that
frozen delivery. Start with [the package guide](review/r12/README.md),
[acceptance evidence](review/r12/ACCEPTANCE_A1_A8.json) and
[companion runtime requirements](review/r12/COMPANION_KIT.json).

With the reviewed Node24.22.0 runtime already available, this source-only check
needs no npm install. Run it from review/r12/application:

```sh
node --test experiments/cometbft-fee-free-lab/public-lifecycle-evidence.test.mjs tests/k4-core-acceptance.test.mjs
```

It uses fresh synthetic fixtures and temporary journals. It does not launch a
live network or require access to old credentials. Windows private Hub/DPAPI
checks are separately scoped; Linux Core binaries and the full binary build kit
are not distributed here. No hosted CI or independently reproduced audit result
is claimed by these instructions.

## Useful submissions

State the commit, component, environment, exact steps, expected/observed result,
impact and a minimal redacted example. Distinguish direct observation from an
assumption. Cite file/line references where possible. Mention AI/tool assistance
and any limits of your review; automated or synthetic output is not an independent
human/legal/operator approval. The r12 implementation itself was AI-assisted.

Keep code changes small and tied to a concrete finding. Preserve original
licensing and upstream notices. Original software is AGPL-3.0-only; original
documentation is CC BY-SA4.0, subject to [the existing scope](LICENSING.md).
No new CLA, copyright assignment, fee promise or production role is created.
Never attach keys, private profiles, local provider stores or operational secrets.
