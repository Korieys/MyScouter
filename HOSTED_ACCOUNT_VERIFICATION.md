# Hosted account verification — October 25, 2026

Status: verified protected preview; customer launch and production release remain unapproved.
Implementation head: 7058d881df81eba0c80b136d5587ae5112a227f8. CI: https://github.com/Korieys/MyScouter/actions/runs/40187600663.

## Real hosted second-account isolation

The owner signed in to the dedicated second account directly in the browser.
Its initial history was empty. Opening each of the first account's three known
saved pack URLs showed “unavailable,” without download controls.

A preview-only checker uses the normal client SDK session and existing APIs;
it does not export tokens or add server read privileges. All **26** final checks
passed: history exclusion, uniform unknown/other-owner record denial, five
denials per first-account pack (metadata, image, ZIP, enhancement, copy), a
foreign-owner history cursor, unsigned history/image/ZIP, malformed credentials,
and four successful owned-pack/cached-processing controls. First-account
requests returned 404, unsigned/malformed sessions 401, and the foreign cursor 400.
The second account's metadata/image and cached enhancement/copy returned 200.
The checker was rerun at the capture cap. No cross-owner DELETE was attempted.

Eight separate tokenless public-object probes returned 403: Google Cloud Storage
and Firebase media URLs for one raw PNG in each of the three first-account packs
and the second account's new pack. No private body or credential was exported.

## Owned capture and checked downloads

At 25cf66b, the second account captured the owner-authorized **public**
https://www.korieygrotesk.com website, including its résumé page, in desktop,
tablet and mobile layouts. This is a real capture of a permitted public site,
not successful website-login proof.

Saved pack: scout-54de3d39-342a-4585-bd58-d356ec3e82eb.
Two pages; 30 raw screenshots plus 20 generated images;44 displayed PNG previews
loaded and decoded (full-page files are included in the ZIP rather than all
displayed). Native ZIP: **11,910,540 bytes**, 50 CRC-verified, fully decoded PNGs.
SHA-256: 5f0cc1ef55d957325163e6ee5e757b3ba6998b90a1ca693a6cda46f4e08f0faa.

After the daily cap was reached, a native home-tablet-hero.png save still
succeeded and matches its ZIP entry byte-for-byte. Owned metadata, image and
saved enhancement/copy requests also remained available.

The repeated diagnostic JSON filename initially failed to save in the in-app
browser. The checker now uses a unique filename and offers visible sanitized
JSON. Both the visible fallback and a native 26-check JSON export succeeded.
These exports contain no ID token, email, captured website text or image data.

## Actual hosted paging and approved cleanup

The owner separately approved temporarily enabling only the preview branch's
READINESS_HISTORY_FIXTURES_ENABLED flag and creating the exact 45 metadata
records in history-fixture-manifest.json. Server checks bind the fixed list to
the second account's SHA-256 scope, the Firebase project and an expiry. There is
no IAM grant, credential export, image generation, AI call or quota reset.
Production and unsigned fixture access are denied in actual Next server tests.

Fixture group: paging-fixture-ebbec1b9-021e-4ea1-9346-1fda4e1b396a.
Hosted history loaded **20 → 40 → 47 unique records**, reached its end, included
all 45 fixture IDs and excluded the first account's packs. The duplicate click
during loading did not skip a page.

The owner then separately approved irreversible cleanup of only those same 45
unchanged metadata records. Cleanup succeeded; refreshed history retained only:

- scout-54de3d39-342a-4585-bd58-d356ec3e82eb — successful public capture.
- scout-30b89d87-07a4-4f98-92a9-074044aea90d — failed fictional login attempt.

All 45 fixture IDs disappeared. No images, first-account packs, Auth identity or
usage counters were deleted. The private marker is retained as removed, so the
group cannot be re-seeded. The branch-only flag was set false afterward; the
deployment-specific disabled-state proof is recorded in outputs/myscouter-hosted-account-verification.json.

## Failure, quota and recovery proof

A reserved .invalid address was rejected and the form recovered. A Basic login
attempt on example.com used only fictional credentials, found no supported form,
and stopped with “No guest capture was saved.” The password field was cleared.
The owned failed-record view correctly says “Capture did not finish,” offers a
new scout and has no ZIP control. The selected korieygrotesk.com site was
explicitly approved for public capture only; positive hosted native-login
compatibility remains unverified.

The fixed nonexistent scout-quota-fixture.example.com hostname was verified as
NXDOMAIN. The bounded quota run observed eight 503 responses, then the account's
daily-limit 429, Retry-After 45543 seconds, and a second 429 on replay. History's
first page was unchanged; later cleanup also confirmed no additional pack.
Earlier public/scoped test attempts were not independently counted from the
database, so the number of 503 responses is not claimed as an independently
audited billable-attempt count. Source ordering fails before record/browser
creation for DNS failure; this is not a cloud billing audit.

The dedicated test account is now at its capture cap until 00:00 UTC
(**7:00 PM CDT, October 25**). Existing saved data and downloads still work.
Global daily exhaustion, edge abuse controls, real session revocation and an
interrupted hosted worker were not destructively exercised.

## Automated proof and limits

**116 leaf checks pass** at 7058d88: 55 application, 18 interface, 27 Firestore/Storage
emulator groups, 14 Chromium scenarios and 2 actual Next production/preview
boundary tests. Types, lint, build, clean install and production audit pass.
Local new focused checks passed 10/10 when run serially. A parallel Windows
test run stalled without output and was stopped; CI and serial runs passed.

Hosted preview means the deployed app and real Firebase/storage services in
the approved test scope. Emulator transaction checks, fulfilled login fixtures
and the 128-MiB Linux native-download test retain their original narrower scope.
The 11.9-MB hosted save is Windows in-app-browser proof, not a physical-phone or
Safari memory test.

Remaining launch work: isolated capture runtime/identity (still not implemented),
monitored retention/account-deletion operations, operator budgets/alerts/support,
positive authorized website-login proof, real revocation/interruption and broader
global-limit/abuse cases, physical devices/Safari, and separate legacy-data review.
The inactive standalone BiDi vendor bundle limitation remains documented.
Storage warnings remain enabled. No merge, production release, payment or
outbound notification was performed.
