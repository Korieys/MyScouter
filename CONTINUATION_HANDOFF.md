# MyScouter continuation handoff — October 25, 2026

Repository: work/MyScouter. Branch: codex/customer-ready-download. Draft PR: https://github.com/Korieys/MyScouter/pull/1. Latest implementation head before this documentation commit: d73fa529525a970bf46335fa1f47456fe506398f. Never reset to the older checkpoint. The only unrelated untracked file is verify-live-bundle.mjs, preserved SHA-256 4d1ff4df224a22880403a0c19ef58e7c94d9dd65e2360c6e343ff2bed51ec0cb.

Read CUSTOMER_READINESS.md, LOGIN_CAPTURE_READINESS.md and LIFECYCLE_OPERATIONS.md. The coordinator still owns the shared report, manifest and review ZIP; none was modified here. Project evidence lives in outputs/myscouter-lifecycle-* plus the approved-deletion, deleted-unavailable, early-progress and concurrency PNGs.

## Completed evidence

CI at 6fd0774: 101 checks plus lint, types, build, production audit; https://github.com/Korieys/MyScouter/actions/runs/40180949644. Fresh hosted capture/early progress and checked download at 6e0dfb6; exact pack scout-2ac0df8b-6c2a-4a86-a161-f932402d18d7, ten decoded PNGs,816341 bytes, SHA-256 888e99d04904b1930903ba01b805e47476f79a0d1aa23c08fddc75287a671446. Source and resolved browser binary/library are unchanged in 6fd0774; its change consolidates npm override sets.

Hosted same-account concurrency rejected a simultaneous second tab; the error released its controls. Saved history/reopen/reload passed. Direct observations saw 11% browser startup and 30% discovery before completion. Previous 22-image proof remains valid for unchanged download and image code, with its original commit scope.

The owner explicitly approved deletion of only scout-5efaedef-0434-4790-97e0-07db860f313f. At52939ef cancellation retained all three packs; confirmed deletion reported success, reload retained two packs, oldURL unavailable. The newer packs were untouched. The later new capture brings history back to three. Do not interpret that approval as permission to delete any other pack or account.

## Pending owner interaction and access

The owner authorized a dedicated second test-account session. The first test account was signed out after its checks. An IAB tab is handed off at the preview login URL with next=/dashboard; do not enter, read back or ask for passwords in chat. Wait for the owner to confirm second-account sign-in, then prove its own history does not contain the first owner's packs and that the known pack URL cannot open. Coordinate before account changes. A specifically authorized dedicated login-fixture URL is also pending.

## Important remaining implementation and operation

The capture browser still runs in the API process with its cloud identity: isolated capture runtime is NOT implemented/deployed. LIFECYCLE_OPERATIONS.md records the required boundary and grants to prepare for specific approval. No new service identity/role/credential was created.

Account-deletion request and bounded cleanup source are implemented and emulated, but ACCOUNT_DELETION_ENABLED and MAINTENANCE_APPLY_ENABLED stay unset/disabled. A monitored operator schedule and approved policy are mandatory before enabling requests; no live account teardown was tested. Auth provider calls in the emulator lifecycle tests are service doubles. Retention has no default duration and no live deletions. Operator JSON signals are not delivered alerts.

Hosted paging needs more than 20 owned records; do not exhaust daily capture/provider quotas just to make fixtures. Daily/global hosted quota exhaustion, full retry/revocation and physical phones/Safari are not proven. Use 45-record emulator results only within that scope.

The production audit is clear, while the unused standalone BiDi mapperTab bundle includes old embedded Zod. Supported Chrome/CDP has no identified route to it; do not claim all BiDi artifacts safe. Keep storage warnings visible.

Smallest decisions: dedicated test-site URL/session; approved fixture seed for hosted paging if needed; worker project/region and spend ceiling; retain-until-delete vs explicit retention duration; account/provider deletion target; response owner and alert/support destination; access to physical Safari/phones. No merge or production release approval exists.
