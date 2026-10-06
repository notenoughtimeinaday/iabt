# TreeBay: Jericho's end-to-end software acceptance benchmark

The owner selected TreeBay on October 5, 2026 as the practical test of IABT's
ability to assess, repair, build, test and prepare an application for Google Play.
This is an acceptance contract for future capability work, not a claim that
Jericho currently builds Android packages or publishes to Google Play.

## Preserve the existing project

Reuse TreeBay's existing source, Play listing and signing identity. Discover
the current revision, package identity, account access and actual Play Console
errors before choosing repairs. Do not restart setup or create replacement
listings merely because an earlier chat lacked access. Coordinate with the
existing TreeBay work and reuse its exported source and evidence.

Keep the IABT release and the TreeBay release separate. IABT remains a standalone
Render/Neon/Resend application. TreeBay's existing infrastructure must first be
inspected; its architecture cannot be inferred from IABT's migration history.

## Required evidence

| Stage | Jericho must do | Acceptance evidence |
| --- | --- | --- |
| Discover | Inspect the authorized repository/export, service availability, dependencies and exact Play Console rejection or warning. | Source commit or archive hash; account/package identity; dated error records; reproducible failures. |
| Diagnose | Link each issue to its cause and a bounded repair; distinguish missing files, broken runtime, policy declarations, account requirements and test coverage. | Traceable issue list with severity, evidence and explicit unknowns. No invented rejection reason. |
| Repair | Propose isolated changes, run authorized reversible work and preserve existing user data/signing continuity. | Reviewable diffs, regression tests, rollback steps and a fresh successful build. |
| Build Android | Select the project's real Android toolchain; validate manifest, dependencies, SDK targets, package/version identity and required service configuration. | Reproducible signed Android App Bundle, hash, certificate fingerprint and build logs. Signing credentials stay outside model context and source control. |
| Exercise | Install and run the app on an emulator/device, including the actual failed journeys and relevant account/payment/file behavior. | Runtime test results, screenshots, crash/log review and evidence tied to the built artifact. A ZIP or successful compilation is insufficient. |
| Prepare Play | Derive permissions, privacy/data-safety declarations, app access instructions and store assets from actual behavior. Add Google service files only for services the app uses. | Reviewed submission package, accurate declarations, compatible signing identity and no unresolved release blockers. Never fabricate consent, identity verification or tester participation. |
| Submit and verify | Upload the exact accepted artifact to the authorized track, inspect processing and pre-launch results, then handle bounded corrections. | Play upload/version receipt and track state. Upload, review submission, publication and Google approval are separate outcomes. |
| Learn | Save each reproduced failure, accepted repair, regression result and release checkpoint with provenance. | Owner-scoped lessons distinguish observations from verified repairs; retries resume unfinished stages without duplicate charges, uploads or releases. |

## Runtime requirements before enabling this workflow

Customer repository and Play authorization must be account-scoped and server-owned.
Generated/uploaded code runs in an isolated build executor, never on the IABT API
host. Tool schemas, budgets, leases, idempotency and artifact verification must
cover the complete workflow. Safe private repairs can run within authorized
limits; credential grants, signing authority, external spending, legal declarations
and release publication retain the applicable explicit approval boundaries.

The UI must show the next concrete step and its evidence. It must not label a
project ready merely because all files exist. Google determines final approval;
Jericho must report rejection or an unavailable capability honestly and retain
the unfinished work for continuation.

## Requirement sources

Refresh these official requirements when preparing the actual submission:

- [Android target API requirements](https://developer.android.com/google/play/requirements/target-sdk).
- [Prepare and roll out a Play release](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en).
- [Google Play Data safety declarations](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).
- [Internal and closed testing](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

These sources describe submission requirements; they do not establish TreeBay's
current rejection reason or prove the benchmark has passed.
