# Isolated capture worker — local implementation, cloud activation pending

The capture engine now supports one fresh Cloud Run Job task per capture. The
current preview still uses the original inline path: no new IAM, job, registry,
budget, protection exception or worker environment values have been applied.
Source publication to draft PR #1 does not activate isolation.

## Data and identity boundary

The API verifies the Firebase owner, account state, DNS and existing account/global
reservation before creating a server-generated scout and worker UUID. It retains
all Firebase and OpenAI credentials and alone commits the final saved pack.
The worker image contains neither those SDKs nor API credential/configuration
files. A dedicated runtime service account is proposed with **zero data roles**.

The API dispatches only a job UUID, random one-job capability and broker URL.
Google's runtime ID token must match the broker audience, exact service-account
email and numeric subject. A SHA-256 capability digest, current owner/scout state,
active account/global lease and expiry are checked at every callback. A job can
claim its encrypted input once. AES-256-GCM uses a random IV and job UUID as AAD;
the key stays in the API. Successful/failing closure clears the encrypted input
and capability; a crash requires the reviewed purge procedure.

The worker uses the existing checked HTTP/CONNECT proxy and same-site native
login engine. Its output is limited to 90 PNGs, 3 MiB each and 96 MiB total.
Uploads are serialized, fully decoded by the API, content-hashed and written with
a create-only generation precondition and a 10-second no-retry storage deadline.
Names are bound to this worker UUID and its server-selected scout prefix. Result
URLs, devices, dimensions and asset references are validated before the API can
commit. Progress uses server-owned messages and advances only through capture;
the existing trail, enhancement/copy stages and checked downloads remain intact.

A real native-login bug was fixed during the container journeys: browser-side
timer promises stalled when site JavaScript was disabled. Settling waits now use
Node timers, preserving disabled site scripts and post-login write blocking.
Worker advanced-login planning sends structural field IDs/forms/kinds only; page
labels and credential values never enter that planner. The original inline
planner remains in the API.

## Tested locally

- 16 worker boundary checks: authenticated identity/audience/subject, encryption,
  capability/asset limits, no credentials in dispatch, no ambiguous launch retry,
  safe failure recovery, hosted-login consent gate and read-only IAM preflight.
  A real storage SDK fault server proves one request on HTTP 503 and cancellation
  of a stalled write.
- 37 Firestore/Storage emulator groups (27 existing + 10 worker): atomic
  reservations, single claim, account/lease fences, cumulative execution budget,
  monotonic progress, serialized immutable uploads, final commit, structural AI
  metadata, exact-version cleanup and preservation of neighboring/referenced data.
- Four native Docker journeys with fictional HTTPS responses and real broker,
  Firestore/Storage emulator and ZIP code: public two-page/three-layout capture
  (30 PNGs), Basic login (5), advanced login (5), and rejected login (0, explicit
  unsupported-login result). All three ZIPs pass every CRC and full PNG decoding.
  Owned private history is visible; a different fictional owner sees no rows.
- The production image renders offline in a read-only container with no network,
  dropped capabilities, no new privileges, UID 10001, 2 CPU/2 GiB and PID limit
  128. Chrome 153, WebGL2 and full PNG decoding pass. Firebase/OpenAI packages,
  API source files, test fixture, npm and npx are absent.
- Existing application/UI checks, lint, TypeScript and the built Next production/
  preview boundary checks pass locally. Full exact-head CI is recorded in the
  project evidence; a build alone is not customer-readiness proof.

The broker identity and AI planner in these Docker journeys are fictional test
adapters. Firebase rules/transactions and object operations are real emulators.
They do **not** prove Google IAM denial, Vercel-to-Google federation, real metadata
identity, hosted worker progress or Cloud Run cancellation.

## Image and advisory limits

The worker uses pinned Node 24.22.1 / Debian 13, matching official Chrome for
Testing headless-shell 153.0.8010.0 and Puppeteer/core 25.11.0. The Chrome archive
is SHA-256 checked before extraction. Install scripts, package managers and
setuid/setgid bits are excluded from the final runtime. See deployment manifests
for exact OCI index, platform manifest and configuration digests.

Root and worker production npm audits report zero advisories. This clears neither
OS nor embedded browser/vendor code. Trivy's final high/critical scan reports
**56 high and 1 critical package findings, 20 distinct CVE IDs**, with no fixes
listed for the installed Debian 13 repository versions. The critical entry is
libxml2 CVE-2026-6653; Debian also lists this installed version as vulnerable and
classifies its stable-release treatment as a minor issue. Reachability from every
browser path is not proven. No finding is suppressed. These residual image
advisories require remediation or an explicit, limited preview risk decision
before deploying this exact image; they block a customer-release claim.

The original four high npm-chain entries were resolved earlier using the
compatible upstream BiDi replacement. The unsupported standalone mapperTab bundle
has a separate embedded schema and remains uncertified. Upstream storage stream
warnings remain enabled and appeared during successful emulator ZIP journeys.

## Inactive deployment and operating proposal

Read [the exact review](worker/deployment/REVIEW.md) and validate its immutable
source/configuration manifest with `node scripts/verify-worker-review.mjs`.
The fixed proposal expires at **7 PM CDT October 26, 2026**. It permits at most
20 API-dispatched captures for the verified second test account plus two
read-only runtime-IAM preflight executions. It does not reset any daily quota.

The hosted proposal is **public capture only**. Worker login is refused before
dispatch unless a separately enabled flag and explicit temporary-storage consent
are present. The UI does not provide that new consent. Positive local login proof
does not authorize hosted storage of website passwords; a dedicated hosted
native-login fixture and reviewed disclosure/credential-retention policy remain
required. Never send passwords through chat.

Interrupted output is fenced after its lease; cleanup waits the existing
390-second writer fence. `npm run maintenance:worker -- --window
isolation-preview-2026-10-25` creates a bounded read-only plan. It can purge
expired encrypted input and propose only exact unreferenced worker objects.
Apply requires a separate enabled environment, approval of the exact plan SHA,
current project, current Firestore timestamps, unchanged scout references and
object generations; plans expire after one hour. No live cleanup ran. Existing
pack/account deletion and retention apply flags remain disabled.

Cloud IAM denial/inherited-policy inventory, hosted progress → private history →
checked ZIP → failure/retry/interruption proof, monitored cleanup/retention and
account deletion, alert delivery/response, positive hosted login, broader token
revocation and physical iPhone/iPad Safari/Android large ZIP tests remain launch
gates. Local Docker controls do not assert that Cloud Run exposes identical
read-only-root/PID controls. The polished app remains a private capture preview.
