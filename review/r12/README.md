# BAARNE r12 local source-review delivery

This is the final finite K1–K8 technical/review delivery, not a production release.
Core Pilot NO-GO. C1–C4 external security/privacy/legal/operator/pilot decisions
remain open. No new default policy is adopted; no remote service is started.
No commit/push/publication has been performed or authorized by this package.

Contents:
- application/: exact175-file selected application plus REVIEW_MANIFEST.json.
  Only pinned ethers distribution and TypeScript parser execute; preserve all
  supplied license/copyright/notice files. Read application/README_REVIEW.md.
- monument/: separately verifiable synthetic M1 history, source and notices;
 96 content files plus CAPSULE.json. This is not the V3 live chain.
- SOURCE_MANIFEST.json, COMPANION_KIT.json and MANIFEST.json bind exact bytes.
- ACCEPTANCE_A1_A8.json, EXTERNAL_REVIEW.md and PUBLICATION_EXCLUSIONS.json state
 accepted evidence, limitations and held/excluded material.

Startup without npm install (Windows lab only): obtain the separately pinned K3
kit/runtime first. From this directory use its Node24.22.0 executable:

```powershell
& 'KIT/runtime/win-x64/node.exe' STARTUP_CHECK.mjs 'NEW_EMPTY_LAB_DIRECTORY'
```

This starts the actual private Hub on127.0.0.1, checks/private.html and closes it.
For an interactive session instead run, from application/:

```powershell
& 'KIT/runtime/win-x64/node.exe' apps/hub/private-server.mjs 'NEW_EMPTY_LAB_DIRECTORY'
```

Use only a new disposable synthetic directory. The session-memory entry is a demo;
durable synthetic operator use requires application/docs/release/OPERATOR_RUNBOOK.md
and separate trusted provider/control pins. Keep generated provider/owner files
outside this source package. Do not upload any generated keys or private workspace.
Windows CurrentUser DPAPI is not production custody, cross-platform recovery or HSM.
Core's Linux binaries/complete source obligations live in the companion kit; do
not substitute its historical node-review directory for this current application.

Offline capsule check, with a capsule hash obtained separately:

```powershell
& 'KIT/runtime/win-x64/node.exe' --import ./OFFLINE_NETWORK_GUARD.mjs monument/verify.mjs 'TRUSTED_CAPSULE_SHA256'
```

The guard blocks JS network APIs; it is test instrumentation, not an OS firewall.
No dependency download is needed. Companion kit manifest pin is in COMPANION_KIT.json.
Use the external DELIVERY_HASHES.json to compare SHA256 of this ZIP and MANIFEST.json
before trusting the file entries. A replaced manifest does not authenticate itself.
Pins authenticate bytes only when received through a separate trusted channel.

No Git history, raw status event log, AWS account/operation evidence, old key-bearing
artifacts, real-user profile data or unreviewed binary assets are included. Nine
historical binaries are explicitly excluded, not privacy/right-cleared. Fourteen
historical key-shaped artifacts remain on hold and were not reopened.
The whole dirty working tree is not an upload candidate. Publish only after owner
instruction/review; rescan changed bytes. Hosted GitHub CI was not run.

Digital monument bytes can be preserved. An active network service still needs
runtime/security maintenance and real accountable operators; perpetual safety
without updates is not claimed. Original software/prose license scope and upstream
exceptions are in application/LICENSING.md and DISTRIBUTION_OBLIGATIONS.md.
