# MyScouter worker: exact inactive approval review

Prepared October 25, 2026. **Not applied. No new cloud access or spend is authorized
by this file.** Existing draft PR source publication is approved separately.
Validate `review-manifest.json` with `node scripts/verify-worker-review.mjs`.
Project evidence and a readable owner review are under outputs/myscouter-worker-*.

## Proposed window

| Setting | Exact proposed value |
|---|---|
| Existing Google/Firebase project | `myscouter-5f16b`, number `778860260835` |
| Region / new job | `us-central1 / myscouter-preview-capture` |
| New Docker registry repository | `us-central1-docker.pkg.dev/myscouter-5f16b/myscouter-preview-worker` |
| Vercel project / branch | `my-scouter / codex/customer-ready-download`, preview only |
| Eligible account | SHA-256 UID `68411256b583176eb38900681b5b833949fc3785904f811e23314799ca93c5fc` (verified second test account) |
| Application worker executions | At most 20 cumulative attempts, failures count; no reset/refund |
| Additional provider executions | Exactly two read-only IAM preflights, before and after the test window |
| Worker limits | One task, parallelism one, zero retries, 2 CPU / 2 GiB, 240 seconds |
| Hard application expiry | `2026-10-27T00:00:00.000Z` = 7 PM CDT October 26 |
| Hosted websites | Public fictional example.com smoke captures; korieygrotesk.com public-only use retains its earlier approval |
| Data / deletion | No customer pack/account deletion, no retention apply, no hosted website passwords |

The Firebase project number is verified from its public Firebase app ID. Billing
account, inherited IAM and Vercel OIDC issuer mode have **not** been verified.
If the window expires, regenerate this review; do not extend it implicitly.

## Exact IAM and provider resources

`resources.json` lists the proposed new resources/APIs. Stop on a name collision;
do not replace an existing account, role, repository, pool, provider, job or budget.

| Principal / target | Grant |
|---|---|
| New `myscouter-preview-capture@myscouter-5f16b.iam.gserviceaccount.com` runtime | **No project, bucket, Firestore, Auth, Secret Manager or dispatch role. No key.** |
| New `myscouter-preview-dispatch@myscouter-5f16b.iam.gserviceaccount.com` | Custom `projects/myscouter-5f16b/roles/myscouterPreviewDispatch`, bound only on the new job |
| Custom dispatch role | Exactly `run.jobs.run`, `run.jobs.runWithOverrides`, `run.executions.cancel` |
| Exact WIF subject on dispatcher | `roles/iam.workloadIdentityUser` on that dispatcher service account only |
| Existing human operator | Use existing authorized deployment/billing access; no new Admin grant |
| Google-managed service agent | Cloud Run's provider-managed `service-778860260835@serverless-robot-prod.iam.gserviceaccount.com`; normal Google-managed service-agent provisioning/image pull, never the runtime identity |

Exact bindings are in `dispatch-role.json`, `job-iam-policy.json` and
`dispatcher-impersonation-policy.json`. `wif-provider.json` proposes team issuer
`https://oidc.vercel.com/korieys-projects`, audience
`https://vercel.com/korieys-projects`, subject
`owner:korieys-projects:project:my-scouter:environment:preview`.
Read-only connector/CLI metadata did not establish the current issuer mode.
Verify actual claims without exposing the token before creating trust; if they
differ, stop and revise the review. Do not change Vercel issuer mode automatically.

**Residual trust:** Vercel's verified subject distinguishes project/environment,
not this branch. Other preview code in this same Vercel project could federate as
the dispatcher. Branch-scoped environment and account/window checks are application
controls, not IAM branch isolation. `runWithOverrides` permits different task
counts/timeouts/arguments/environment; IAM does not enforce the application's 20
attempts or 240 seconds. It cannot change this role into job-update permission,
but a compromised authorized preview can incur extra executions. The etag guards
ordinary template drift; it is not a secret or a dollar cap.

## Image, deployment and callbacks

`job.json` pins the locally tested OCI image index digest:
`sha256:726fbc06daccd3ce9768993f49bff5d2548a876c5ccf3c5b6f1bc91e58e42e67`.

Its linux/amd64 manifest is
`sha256:a8ce36718440c68f8c5e4360c28324712c2734dee54aa435631d53a9aa8db817`;
config digest
`sha256:ae468b48f000884079dc1eed96d56af98bb1a4c9b2260f070170b5f3d3466b6c`.
The local Docker archive/index descriptors prove these distinct values.
Publication must preserve and reverify this exact digest. CI rebuilds verify
source behavior; mutable Debian repositories/build provenance mean a rebuilt
image need not have the same digest. A changed image requires fresh scan/proof
and a revised review. No registry push has occurred.

The worker has no ingress service. It calls the exact API broker at
`https://my-scouter-git-codex-customer-ready-download-korieys-projects.vercel.app/api/capture-worker`.
Callbacks require Google ID-token issuer/audience/exact runtime email/numeric
subject, one-job capability, current owned scout/account and active lease.
The API alone holds the encryption key and provider credentials.

**Required protection exception:** `protection-exception.json` proposes temporarily
unprotecting **the entire existing branch domain**
`my-scouter-git-codex-customer-ready-download-korieys-projects.vercel.app`.
Vercel does not scope this exception to the callback path: all current/future
deployments at that domain become publicly reachable until the exception is
removed. Firebase app authorization and worker ID-token/capability checks remain.
No broad protection-bypass secret is sent to the browser worker. This domain
exposure needs explicit approval and re-protection at window closure.

`activation-config.example.json` is branch-scoped. The numeric runtime unique ID
and job etag must be read from the created, verified named resources, not guessed.
Generate the 32-byte envelope key through the approved API secret mechanism.
Never include it, a Vercel token, a Firebase key or an OpenAI key in an execution
override/evidence file. Keep the login and all destructive apply flags disabled.

## Budget, alerts and response

`budget.json` proposes a **USD 5 Google Cloud project budget** for October 25–26
(end date October 27 exclusive), excluding credits, with actual-spend alerts at
**USD 1, USD 2 and USD 5**. Default recipients are the existing billing account's
Billing Account Administrator/User IAM role holders. Approval includes these
provider-generated notifications; no test email or new recipient is proposed.
Existing project spend in that period counts and may immediately trigger an
alert. Resolve the existing billing account before apply. If billing is disabled,
stop: this review does not authorize attaching an account or upgrading a plan.

This is an alert budget, **not a hard spending cap**. Vercel and OpenAI charges are
outside it. For ordinary compliant operation, 20 × 240-second captures plus two
60-second-minimum preflights at 2 CPU / 2 GiB use at most 9,840 vCPU-seconds and
9,840 GiB-seconds, about **USD 0.1968 compute** at the cited us-central1 rates,
before free allowances. Registry/storage, logs, egress, existing app traffic and
abuse are additional. Twenty full 96-MiB worker uploads are 1.875 GiB raw storage.
A 256-MiB capture proxy limit is an application network control, not a bound on
native exploit traffic.

The owner must identify who watches the billing alerts and the manual worker
status/cleanup reports during the window. At the first USD 1 alert, unexpected
execution, permission-probe success, expired payload, repeated failed upload or
unexplained storage growth, stop dispatch, cancel only reviewed active worker
executions and re-protect the domain; investigate before resuming. Do not wait
for USD 5 or assume budget mail stops resources. No monitoring scheduler, custom
notification channel or support message has been created.

## Advisory gate

The final image scan reports 56 high + 1 critical package findings (20 distinct
CVE IDs); no fixed versions are listed for the configured Debian 13 packages.
Critical `CVE-2026-6653` is installed libxml2; Debian lists this version as
vulnerable, with minor-issue/no-DSA treatment for trixie. That difference in
classification is recorded, not an exemption. No reachability certification or
suppression has been made. Exact findings are in project evidence.

**Do not deploy this exact image without remediation or a separately explicit
owner decision accepting these listed residual findings for this public-fixture,
20-attempt preview window.** Such a decision would not approve customer use,
real website credentials or a production release. The npm chain is clear; that
does not certify the container or Chromium itself.

## Apply sequence after specific approvals (not executed)

1. Validate the review manifest, source head and archived image descriptors. Verify
   existing project number, linked billing account, enabled Firebase data APIs,
   current inherited project/folder/organization/bucket IAM, Vercel OIDC claims
   and resource-name absence. Stop on any mismatch or an inherited runtime grant.
2. With existing operator access, enable only missing listed provider APIs; create
   the listed Docker repository, two keyless service accounts, custom role,
   WIF pool/provider and exact dispatcher impersonation binding. Provision the
   reviewed budget on the already linked billing account. Record provider-generated
   service-agent roles. Do not grant data roles to the runtime.
3. Push the **already tested** local image to the named repository, verify the
   remote OCI index/platform/config digests against this review, then create the
   new job using `job.json`. Read back its full template and IAM; bind the custom
   role only on that job. Do not replace existing policies with guessed etags.
4. Run `preflight-run.json` once with the newly read job etag. It invokes only
   `worker/preflight-main.ts`, checks the exact metadata identity, tests IAM
   permissions, and reads nonexistent fictional object/document names and Auth
   configuration. It performs no writes, deletes, user enumeration or object
   listing. Permission tests must be empty and reads must deny (403), with APIs
   enabled; local mocks are insufficient. Any unexpected grant stops activation.
5. Only after passing the IAM gate and obtaining the domain exception approval,
   configure the exact preview branch values/secret and temporary domain
   exception, then redeploy that branch. Do not activate production or another
   account. No hosted worker login, account deletion, retention apply or quota reset.
6. Using the dedicated second account and public fictional pages, verify real
   early progress, own saved history/reopen, another owner/anonymous denial and
   native checked ZIP contents. Exercise one bounded interruption/failure/retry,
   prove no late commit and inspect the read-only exact worker cleanup plan.
   Preserve outputs; cleanup/apply needs separate exact-plan approval.
7. Run the second read-only IAM preflight, disable worker dispatch and redeploy,
   remove the domain exception, and verify the protected default-inline preview
   and unavailable worker endpoints. Disable the new WIF provider/remove its
   dispatcher binding to close trust after the window. Preserve the image,
   execution receipts and plans for review; deleting cloud resources or data is
   not implicitly approved by this review.

If cancellation is ambiguous, never retry `:run`. Wait out the 250-second
capability and 390-second cleanup fence; the API cannot accept expired output.
Review object generations before any subsequent destructive cleanup.
An operator must purge expired encrypted input after a process crash; no
unattended maintenance service is active.

## Smallest owner decisions

1. Approve or decline these exact new resources/IAM and USD 5 budget/role-based
   alerts, with the project-preview federation breadth and execution-override
   limitation understood; name the operator watching the window.
2. Approve or decline the temporary **whole branch-domain** protection exception.
3. Require image remediation, or explicitly accept the attached residual OS CVEs
   only for this expiring public-fixture test window.

Positive hosted website login, retention duration/account completion policy,
alert delivery tests and physical Safari/phone downloads remain separate launch
decisions. No customer launch or merge is requested here.

## Primary sources

- [Cloud Run execution overrides](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run)
- [Job service identity](https://docs.cloud.google.com/run/docs/configuring/jobs/service-identity)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Budget behavior and recipients](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [Vercel GCP federation](https://vercel.com/docs/oidc/gcp) and [claims](https://vercel.com/docs/oidc/api)
- [Whole-domain protection exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions)
- [Debian CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653)
