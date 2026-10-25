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

Hosted progress-query behavior still needs confirmation: emulator queries do not
prove production index availability. Real login-provider compatibility, a second
hosted owner account, live deletion of the synthetic pack and customer release
remain separate gates. The existing four high dependency audit entries in the
Puppeteer dependency chain remain documented; no incompatible browser upgrade is
included in this merge.
