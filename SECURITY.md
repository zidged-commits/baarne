# Security reporting

BAARNE r12 is a synthetic source-review candidate. There is no approved
production deployment or supported real-user pilot. The technical checklist
is complete; independent security/privacy/legal/operator reviews remain open.

## Report privately

For a suspected vulnerability use [GitHub private vulnerability reporting](https://github.com/zidged-commits/Baarne/security/advisories/new).
Private vulnerability reporting is enabled for this repository. Reports go
through GitHub to repository maintainers; this is not an independently staffed
security service or an established response-time/bounty programme.

Do not publish exploit details, actual keys, tokens, private profiles, consent
records or personal information in public Issues/Discussions. A useful private
report identifies the commit/file, affected boundary, impact, expected versus
observed behaviour and minimal reproduction with newly generated synthetic data.
Use placeholders for credentials and identities; do not include real secrets.

Use the [public technical finding form](https://github.com/zidged-commits/Baarne/issues/new/choose)
for ordinary non-sensitive bugs. If unsure whether disclosure would expose a
vulnerability or private data, use the private route first.

## Scope

Review the [source and trust boundaries](REVIEW_REQUEST.md) and
[operator limitations](review/r12/application/docs/release/OPERATOR_RUNBOOK.md).
Use fresh local synthetic workspaces for reproductions. Neither this request
nor the code license authorizes testing unrelated systems or processing real
participant data. No legal safe-harbour or incident-response agreement is
created here. Test success does not replace an independent security assessment.
