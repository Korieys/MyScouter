# Website login capture integration

This draft integrates main through `9c0d74c` (trail animation, early progress,
authenticated scouting and disclosure), while retaining private account-owned
packs, bounded processing, checked ZIP downloads and confirmed pack deletion.
The owner approved this integration and draft publication on 2026-10-24. It is
not approval to release the app or use real third-party credentials.

## Customer behavior

- The signed-in account starts authenticated progress observation before the
  capture request. A client-generated `job-UUID` correlates progress only. The
  server independently generates each saved `scout-UUID`; it never overwrites a
  pack selected by the client. Progress reads filter by verified owner and job.
- The trail moves forward through capture, enhancement and copy. Completion is
  shown only after the copy attempt; optional failures open the saved pack with
  retry guidance. Navigation keeps the form disabled. Leaving or switching
  accounts cancels client work and ignores late results; a server capture already
  in progress may still finish and be available in its owner's history.
- Basic login uses a native username/password POST form. Advanced login sends
  only bounded, redacted field metadata to AI, whose output can select existing
  field IDs within one form. Actual credentials are inserted afterward, locally
  in the capture browser. Consent is checked on both client and server.
- Login and capture must use the same HTTPS origin with no query or fragment.
  A maximum of two native form submissions supports username-then-password.
  Scripts are disabled. Only one checked main-frame POST is allowed per step;
  writes are disabled afterward. Other origins remain blocked.
- Script-only forms, external identity providers, verification codes, CAPTCHA,
  ambiguous forms and unverified sign-in stop with an explanation. No silent
  guest fallback. Successful verification requires a changed cookie, a readable
  requested target and no visible login or challenge controls. This is a bounded
  compatibility check, not proof of an arbitrary website's account semantics.
- Authenticated scouting captures the selected page only. It does not follow
  account navigation links, which may trigger actions through GET requests.
  External assets and scripts may be unavailable. The form discloses these limits.
- Credentials are not stored as account details, logged, or placed into AI
  prompts. Exact credential text is redacted from captured text, titles and
  visible form/text content. Captures can still include other private information;
  users must choose appropriate pages and review results before publishing.

## Verification and remaining gates

Tests cover validated consent/origins/field plans, redacted metadata, native
single- and two-step login, rejected credentials, unsafe form destinations,
post-login write blocking, account-scoped progress and early/forward/cancelled
client progress. Browser fixtures use only fictional credentials and locally
fulfilled responses. The existing browser network, ZIP, owner, quota and deletion
checks remain required in CI; exact results are in the PR and readiness report.

Hosted owner/job progress is now directly observed at 6e0dfb6: browser startup and page-discovery details precede a successfully saved pack (displayed trail values were 11% and 30%, with animation easing). A concurrent second-tab request was rejected and its form recovered. The trail and login flow remain unchanged. Native form compatibility still has six passing fictional Chromium scenarios on the same Chromium 153 launch path; second-owner isolation is now proven. The owner selected korieygrotesk.com for public capture only, so positive hosted native-login compatibility remains pending.

The separately approved old synthetic pack was deleted successfully after a cancellation check; history/reload and unavailable old-URL checks passed at 52939ef. The fresh capture/history/ten-image ZIP workflow passed at 6e0dfb6. See CUSTOMER_READINESS.md for exact evidence and scopes.

The four npm advisory entries are cleared by the upstream BiDi dependency replacement while preserving Puppeteer 25.11/Chromium 153 and explicitly selecting Chrome/CDP. The unsupported standalone mapperTab vendor bundle still contains an older embedded schema; it has no identified application route and is not certified. Native process isolation, hosted supported login, broader revocation/global-limit proof, retention/account operations and physical devices remain release gates. No production application release is approved.

## Hosted second-account follow-up

See HOSTED_ACCOUNT_VERIFICATION.md. All 26 endpoint controls pass with the actual second-account session, alongside 50-PNG native saving, hosted 20/40/47 history paging, daily-cap/replay enforcement and exact approved fixture cleanup. Basic login on a no-form public fixture stopped explicitly with fictional credentials and no guest capture; the failed record offered recovery without a ZIP control. No real third-party credentials were used.

## Isolated-worker local follow-up — October 25

The extracted engine now passes native Docker Basic and advanced fictional login
journeys with five fully decoded PNGs each, plus explicit rejected-login recovery.
Node-side settling timers fix a hang after native submission while page scripts
remain disabled. The separate worker planner sends field IDs/forms/kinds only;
website labels and credentials do not enter that AI input.

This does not add positive hosted login proof. The proposed initial worker window
is public-only; its login flag and new temporary-storage consent remain absent.
Encrypted job input is cleared on completion/failure, but interrupted input needs
the reviewed operator purge. A hosted credential-retention disclosure/consent and
dedicated website fixture require separate review. No real website credentials
were used. See ISOLATED_CAPTURE_WORKER.md and worker/deployment/REVIEW.md.
