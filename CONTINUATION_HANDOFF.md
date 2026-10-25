# MyScouter handoff — October 25, 2026

Branch: codex/customer-ready-download. Draft PR: https://github.com/Korieys/MyScouter/pull/1.
Latest worker implementation: see the exact source commit/CI/deployment in
outputs/myscouter-worker-verification.json. Previous hosted implementation was
7058d881df81eba0c80b136d5587ae5112a227f8; its evidence retains that scope. Read HOSTED_ACCOUNT_VERIFICATION.md,
CUSTOMER_READINESS.md, LOGIN_CAPTURE_READINESS.md and LIFECYCLE_OPERATIONS.md.

The second account is now verified in the protected preview. All 26
authenticated/anonymous ownership checks pass; eight direct object URLs deny
public access. Its real public-site capture has 50 decoded PNGs in an 11,910,540
byte native ZIP. At the capture cap, native PNG saving and cached copy/mockup
access still work. Hosted paging passed 20/40/47 with 45 approved metadata
fixtures; separately approved cleanup removed exactly 45 and preserved the
successful capture and failed login record.

No more fixture cleanup approval is pending. The removed marker prevents
re-seeding; READINESS_HISTORY_FIXTURES_ENABLED was set false for this preview
branch. The final preview window state and exact deployment are recorded in outputs/myscouter-hosted-account-verification.json.
No other environment value or IAM role was changed. Whole-account deletion and
maintenance-apply remain disabled. The second account remains signed in and is
at its capture cap until 00:00 UTC (7 PM CDT October 25). Do not reset usage.

Successful pack: scout-54de3d39-342a-4585-bd58-d356ec3e82eb.
Failed fictional login: scout-30b89d87-07a4-4f98-92a9-074044aea90d.
Preserve both; the owner approved only the 45 fixture cleanup in this turn.
The first account's three saved packs were not modified.

116 checks pass at 7058d88: https://github.com/Korieys/MyScouter/actions/runs/40187600663.
Project evidence: outputs/myscouter-second-account-*,
outputs/myscouter-hosted-paging*, outputs/myscouter-hosted-quota*,
outputs/myscouter-paging-cleanup*, and the updated fixture review/manifest.

The owner chose korieygrotesk.com for PUBLIC capture only. It has no supplied
native-login fixture. No real website credentials were used; do not ask for
passwords in chat. Unsupported Basic login stopped explicitly with no guest pack.

Customer launch still needs the locally implemented separate runtime activated
and verified with real Google IAM and hosted interruption/download proof,
monitored retention/account operations, spending/alert/support decisions,
physical Safari/phone tests, positive hosted login and broader revocation,
interruption/global-budget proof. Do not promote this preview to customer-ready
or merge/release it from these tests.

Untracked verify-live-bundle.mjs remains untouched; SHA-256
4d1ff4df224a22880403a0c19ef58e7c94d9dd65e2360c6e343ff2bed51ec0cb.
Leave the coordinator's shared report, manifest and ZIP alone.

## Worker continuation handoff

Read ISOLATED_CAPTURE_WORKER.md and worker/deployment/REVIEW.md first. Source
publication is approved; cloud activation remains pending. No IAM, registry,
Cloud Run job, billing alert, protection exception, worker environment value or
live destructive operation was applied. The signed-in browser/account was not
used or switched during this local implementation.

The final Docker image uses pinned Node 24.22.1/Debian 13 and matching official
Chrome 153. All four local public/Basic/advanced/rejected-login journeys pass
(40 decoded PNGs, three CRC-checked ZIPs). A script-disabled native-login timer
hang was fixed; existing UI trail and checked downloads are preserved. Local
unit/emulator/production-image proof is recorded separately from historical
hosted captures. The storage SDK stream warning remains visible.

The exact inactive review contains IAM JSON, image digests, USD 5 role-based
budget alerts, 20 cumulative API captures plus two read-only IAM preflights,
and a fixed 7 PM CDT October 26 end. Verify Vercel issuer claims/inherited IAM
before apply. The trust subject covers all project previews; the proposed
Vercel exception exposes the whole exact branch domain. Neither is applied.
The final scan still reports 56 high/one critical OS package findings across
20 CVEs; obtain remediation or explicit limited-preview risk acceptance.

The owner decisions are exact infrastructure/budget/alert/operator approval,
whole-domain exposure approval and the listed image advisory decision. Hosted
worker website login, destructive apply, quota resets and customer release
remain outside scope. No approval question requires a password in chat.

Use the exact image archive/digests from project evidence; CI rebuilds can differ
without source drift because Debian/build provenance changes. Revalidate the
canonical LF review manifest before any cloud operation. After expiry regenerate
the review; do not silently extend the window. Preserve all existing packs and
the untracked verifier. The shared report, manifest and ZIP remain coordinator-owned.
