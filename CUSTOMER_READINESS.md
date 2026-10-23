# MyScouter customer-readiness repair

Status: draft PR, not a production release. The earlier public ZIP implementation was verified in a hosted preview. This follow-up changes storage and account access and requires a fresh signed-in hosted check before release.

## Behavior

Every capture, enhancement, copy, archive, image, history and progress request requires a Firebase ID token, including revocation checking. A caller-supplied user ID does not select ownership. Missing and other-owner records return the same unavailable response. Request identity caching ends with that request.

Captures use random UUIDs and persist authoritative records in `privateScouts`. Images are stored at `private-scouts/{id}/{name}.png` with an explicit private object ACL and no public download token. The server derives asset names from the owned record; it never fetches caller-provided image URLs or local file paths. Client views use authenticated image blobs, clear their scope when the account or record changes, and reopen data from the server rather than localStorage. Optional enhancement or copy failures leave the captured pack accessible with retry controls.

The ZIP keeps its integrity checks, limits of 150 files and 128 MiB, batches of four asset reads, and a 45-second loading deadline. Individual reads have a 15-second deadline and 20 MiB limit. Completed downloads stream in 64 KiB chunks with private/no-store headers. The app reports a failed or incomplete archive instead of returning a partial success. [Vercel recommends streaming large responses](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

The capture worker checks HTTP(S), standard ports, URL credentials, DNS answers and private/reserved address ranges. Chromium uses a per-capture HTTP/CONNECT proxy which resolves each connection and pins the connection to the checked numeric address. Loopback bypass, direct fallback, QUIC, certificate-ignore and web-security-disable flags are excluded; service workers are bypassed. The proxy has limits of 256 MiB received, 1,500 connections and four minutes. A capture closes its browser after four minutes. Screenshots are bounded to 12,000 pixels high and saved sequentially to avoid retaining all image buffers. Up to six pages and three device layouts are supported; unavailable interior pages are skipped.

Puppeteer/core 25.11.0 and Chromium-min/binary 153 are aligned. Sources: [Puppeteer compatibility table](https://pptr.dev/supported-browsers), [Sparticuz](https://github.com/Sparticuz/chromium), [Chromium proxy documentation](https://github.com/chromium/chromium/blob/main/net/docs/proxy.md).

AI copy uses saved website evidence, validates the returned shape, persists successful drafts, and does not fabricate fallback testimonials or results. The interface discloses website-text transmission to OpenAI and asks customers to review drafts.

## Live configuration inspected October 23, 2026

- Project: `myscouter-5f16b`; bucket: `myscouter-5f16b.firebasestorage.app`.
- Existing Firestore rules allow customers their own user profile and allow public individual reads of legacy `scouts`. No client rule matches `privateScouts`, so new private records are denied through client SDKs. Admin routes enforce ownership themselves.
- Existing Storage client rules expired March 23, 2026 and deny client access. The server uses the already configured Admin identity. Bucket permissions show fine-grained object ACLs and no allUsers/allAuthenticatedUsers bucket-wide grant.
- Added and verified Enabled one collection index for `privateScouts`: `userId` ascending, `createdAt` descending; index ID `CICAgOjXh4EK`. The index does not grant access. Existing security policies and credentials were not changed.
- Legacy records and public image objects were not migrated, deleted or made private. Earlier timestamp IDs are not accepted by the new owner API. Do not advertise retroactive privacy or recovery of untrusted legacy ownership.

## Verification

18 local regression checks cover archive contents and failures; a streamed file larger than 6 MiB with exact SHA-256 and chunk limits; unsigned requests to all eight endpoints; identity, revocation, cross-account and missing-record handling; safe file references; input limits; output privacy; copy validation; private/reserved addresses; all-answer DNS checks and rebinding; actual local HTTP/CONNECT rejection; proxy connection limits and idempotent cleanup. Tests use fictional identities and service doubles; they do not substitute for hosted two-account verification.

TypeScript, lint and a production build are required. CI uses fictional public Firebase settings, no server credentials and no downloaded browser. The production dependency audit currently reports 20 advisory entries (0 critical, 11 high, 8 moderate, 1 low); remaining advisories need scoped follow-up.

## Remaining release gates

- Fresh hosted capture, enhancement, copy, history and reopen, individual download, and ZIP integrity on this private-storage implementation.
- Hosted anonymous and second-account rejection, plus direct unauthenticated object denial.
- Real Chromium proxy-path verification, including redirect/subresource denial and normal public sites. Unit tests do not prove all browser network paths or isolate native browser exploits.
- Shared per-account rate limits, concurrency leases and spend limits for capture and AI work. Current request limits and cached successful stages do not prevent repeated or simultaneous work.
- A dedicated isolated capture worker with restricted cloud identity, retention/cleanup, user deletion, recovery of interrupted work, older-history pagination, support and mobile checks.
- Resolve remaining dependency advisories; review legacy data exposure separately. No automatic legacy ownership migration is safe because the old API trusted caller identity.

No merge, production application deployment, payment, outreach or customer-data deletion is included.
