# Standalone JERICHO uploaded-file acceptance

Evidence date: September 18, 2026.

## Runtime checked

- Canonical repository: `notenoughtimeinaday/iabt`.
- Independent frontend: https://iabt-staging-web.onrender.com
- Independent API: https://iabt-api-insured-spending.onrender.com
- Inspected deployed commit: `e77ee4f591cd3163975186f06e45b33446ba5173`.
- Live `GET /readyz` returned standalone version `0.7.0`, PostgreSQL and S3 healthy, four applied migrations with none pending, and `base44_required: false`.
- Email readiness was `configuration_only`. It does not prove inbox delivery.
- An actual browser sign-in returned: "This account was migrated from Base44. Use Forgot password to create a standalone IABT password." No authenticated standalone session was established.

## Repair scope

The previous UI discarded permanent upload IDs and retained five-minute download links. The standalone planner also discarded uploaded-file context. Source review now uses owner-authorized stored IDs, validates file size and SHA-256, reads bounded UTF-8 from private storage, binds the references into the quote, and rechecks them during execution.

The first supported result is a deterministic document containing source inventory, candidate requirements with line references, and complete decoded source evidence in Markdown. Word and PDF reading copies are also produced. This does not implement arbitrary semantic analysis, uploaded-code execution, repository changes, or PDF/Office/media parsing. No generation-provider call is made. Existing explicit approval and one-IABT-credit accounting remain in force.

Limits: 12 files, 128 KiB and 2,000 lines each, 256 KiB and 4,000 lines total. Supported inputs are UTF-8 text, Markdown, JSON, CSV, and the common source-code extensions listed in `server/src/files/text-sources.js`.

## Local verification

`server/test/source-review.test.js` exercises real local HTTP upload, saved conversation reread, signed plan, approval, worker, and private Markdown/DOCX/PDF download. Its verification marker appears only in the uploaded file, not the prompt. It also checks renewed download links, recreated storage adapters, cross-account isolation including administrators, corrupted/missing files, refunds after failed execution, inert source code, unsupported formats, and byte/line limits. S3 reads use a controlled transport in tests; these tests do not prove a live S3 upload.

Frontend checks cover durable IDs, fresh authorized download links, partial-upload retries, asynchronous synchronization, failed and stale attachment reads, and conversation isolation. The full `npm run verify` command passed locally: lint, type checking, Exchange checks, deterministic creation checks, 135 backend tests, 10 file-interface tests, five frontend build-isolation tests, and the production build. Three additional backend tests were skipped because a disposable PostgreSQL test service was absent. CI supplies that service; a healthy live readiness check is not a substitute for those tests or a live uploaded-file journey.

## Live acceptance still required

1. Complete password recovery using the migrated standalone account. Enter reset codes and the new password only through the application's secure form. Confirm inbox delivery and a fresh signed-in page.
2. Deploy the reviewed repair to independent staging. Record the API and frontend commit; a build or a deployment marked live is not itself workflow acceptance.
3. Upload `server/test/fixtures/jericho-upload-project.md` through Studio. Reopen the conversation and confirm the attachment remains. Download it using a renewed private link and compare its contents.
4. Ask: "Create a report from the attached file listing its verification marker and requirements." Do not repeat the marker in the prompt.
5. Review the one-credit, zero-provider-cost quote before approving it. Record plan, job, source file and artifact IDs, timestamps, status, and credit outcome without recording credentials or signed URLs.
6. Reopen the deliverable and verify the source-only marker and all three requirements in the report. Download and open the Markdown, DOCX and PDF results.
7. Confirm anonymous and a separate ordinary account cannot obtain the source or resulting artifact. Use disposable test accounts and files; no family records are needed.

No DNS changes, live payments, new hosting purchases, or Base44 changes are part of this acceptance.
