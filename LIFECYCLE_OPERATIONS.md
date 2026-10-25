# Private capture preview: lifecycle and launch operations

This is implementation and a reviewable operating procedure, not proof that the
worker, retention policy, alerts or customer account deletion are live. Do not
enable `ACCOUNT_DELETION_ENABLED` or `MAINTENANCE_APPLY_ENABLED` from publication
of this document alone. No production release is approved.

## Implemented boundaries

Account deletion requires a revocation-checked ID token, a sign-in within five
minutes and the literal `DELETE ACCOUNT`. The route defaults to unavailable until
an operator explicitly enables it. The accepted request transaction conflicts
with all three account work reservations and refuses active work. A private,
server-only tombstone then blocks new account API reads, cached-result requests
and work reservations. An already authorized download may still finish, and
already delivered bytes cannot be revoked. Deletion cannot be canceled after
acceptance.

The operator runner disables the identity and revokes refresh tokens before
removing data. Each pass removes at most one account-owned private pack, using
the existing exact UUID-prefix cleanup and partial-failure recovery. It never
selects a legacy `scouts` document, other owner, neighboring prefix or downloaded
copy. Usage counters remain for quota enforcement; they contain hashed account
identifiers and expire operationally only after an approved policy is chosen.

The inspected client rules permit own-profile writes using an already issued
Firebase token. Disabling Auth does not instantly invalidate such a token at
Firestore. Finalization waits **65 minutes after successful disabling/revocation**,
then removes the profile and Auth identity. If any provider operation fails,
the tombstone remains and the operator retries. A completed tombstone retains
the account hash and lifecycle dates, but removes the UID. Provider backups,
soft-deleted object versions, logs, AI-provider retention and previously
downloaded files are outside active-record deletion; their policy must be
reviewed before promising a deletion deadline.

The token lifetime and revocation distinction follows
[Firebase's session documentation](https://firebase.google.com/docs/auth/admin/manage-sessions).

History refresh recovers a capture left `capturing` for at least 390 seconds.
The capture runtime is 300 seconds, its lease is 330 seconds, and recovery adds
60 seconds for skew. Recovery marks the incomplete pack failed and clears its
incomplete saved content; it does not delete the pack or storage. An expired
worker cannot commit after this fence. Its owner can use confirmed pack deletion
to remove orphaned assets, or an operator can review a bounded cleanup plan.

## Read-only operating check

Use Node 24, reviewed dependencies, the intended project and a dedicated operator
identity. Supply credentials through the approved runtime secret mechanism;
never put them in a command line, evidence file or AI prompt.

`npm run maintenance:plan` performs bounded reads and prints JSON. It scans at
most 100 records and produces at most 20 actions per page. Use its `nextCursor`
as `--after scout-UUID` to inspect subsequent pages. It reports interrupted
captures, incomplete confirmed deletion, requested account deletion, daily job
consumption, concurrency and 80%-of-daily-capacity signals. It makes **no writes**.

There is no implicit automatic-retention duration. An operator-approved value
from 1 to 365 can be modeled with `--retention-days N`. This still only prints a
plan. Review all exact owners, pack IDs, proposed actions and the project.

Save the exact plan outside version control, calculate SHA-256 and obtain
specific approval for its live operations. Apply needs **both**
`MAINTENANCE_APPLY_ENABLED=true` in the dedicated operator runtime and
`--apply-plan PLAN.json --sha256 EXACT_DIGEST`. The plan must match the current
project and be at most one hour old. Each target is checked again against its
exact database update time; changed records require a fresh review. Application
usage caps are never refunded. A plan with an account request removes one pack
per pass, so regenerate the bounded plan until that account finalizes.

Do not use this runner to delete existing customer packs under the portfolio
assignment. Approved hosted deletion is limited to the exact synthetic
`scout-5efaedef-0434-4790-97e0-07db860f313f` pack and the separately approved
45 metadata fixture rows in `history-fixture-manifest.json`. Both are complete;
these approvals authorize no further pack or account deletion.

## Required worker separation

The current capture route still launches Chromium in the API runtime. Proxy
restrictions are network controls; they do not isolate a native browser exploit
from the API's Firebase identity. **This remains a customer-launch blocker.**

Concrete next implementation/deployment boundary:

1. Run one capture per disposable container with concurrency one, a 240-second
   browser deadline, bounded CPU/memory and a dedicated service identity that has
   no Firebase Auth, Firestore, Secret Manager or bucket read/list/delete roles.
   Never pass the API environment or Firebase/OpenAI keys to that container.
2. Keep owner authentication, account/global reservations and final record writes
   in the API. Authorize worker jobs for one server-generated UUID and one
   expiring lease. Authenticate invocation with an audience-bound platform token.
3. Let the API broker bounded, attempt-specific uploads; the worker must not
   receive a bucket-wide credential. Return only validated metadata and progress
   for the same lease. Fence late output and clean it only after both execution
   and upload authorization have expired.
4. Deploy a **preview-only** worker and dedicated identity after the owner approves
   the project, region, spend cap and exact IAM grants. Prove the worker's lack of
   Auth/Firestore/object-read/delete access using fictional fixtures, then rerun
   the hosted capture/login/ZIP and interrupted-worker tests.

No new live identity or cloud role has been created by this change. A second
Firebase Admin certificate in the same process would not satisfy this boundary.

## Budgets, alerts and release checks

Existing hard shared limits remain 100 capture attempts, 300 enhancement attempts
and 300 copy attempts per UTC day, with 3/6/12 concurrent jobs. Per-account limits
remain 10/30/30 attempts with one active job of each kind. These limit provider
job counts; they do not guarantee a dollar ceiling or bound retained bytes,
network egress, request abuse or every cloud charge.

The plan's JSON signals are suitable input for an approved scheduler/monitor.
They are **not delivered alerts**. Before customer release, assign a response
owner and approved destination, configure cloud and AI spending notifications,
and test delivery with a fictional event. Do not send that event or configure an
outbound destination without approval. Monitor failures, stale captures,
oldest pending account deletion, failed cleanup, storage growth and capacity.
Do not include page content, passwords, tokens, email addresses or signed URLs
in telemetry. Keep the existing upstream storage warning visible.

Minimum owner decisions: worker project/region and spending ceiling; automatic
retention duration (or explicit retain-until-delete policy); account-deletion
completion target and provider-backup treatment; named operator and alert/support
destination. These choices precede enabling/scheduling live maintenance and
account requests. A tested monitored schedule must be running before enabling
account deletion; otherwise the API intentionally rejects the request.

Physical iPhone/iPad Safari and Android download checks remain required. Existing
Linux Chromium tests cover a 128-MiB synthetic ZIP; they do not prove physical
phone memory behavior. This preview continues to buffer files for hashing.
