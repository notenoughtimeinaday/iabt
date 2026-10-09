# Jericho simplified core release

Updated October 9, 2026. This supersedes media expansion as the public release
scope. It preserves prior work and focuses on making the core flow useful.

## Product scope

- One request box on Home; recent work, saved files and account controls.
- Studio shows the actual result, its preview, download and Make a change.
  Conversation history, quote internals and activity details are optional.
- Named starter apps are available without a paid AI supplier. Custom apps and
  revisions require the existing configured Responses provider and cost consent.
- HTML apps are self-contained; the source ZIP contains the same index.html.
  No external libraries, network services, shared accounts or payments are
  implied by an exported app. Preview storage is temporary when the browser
  blocks storage inside the private sandbox.
- Existing files, conversations, projects, credit balances and accepted jobs
  are preserved. New media, manufacturing and automation requests are paused
  under the default core profile. An explicit advanced profile is admin-only.
- Jericho's versioned curriculum records the smaller scope and the source-bound
  revision process. Learning is account-scoped evidence, not authority to spend,
  publish, change permissions or overwrite its own runtime.

## Acceptance and evidence

The new browser journey is being checked against a local account fixture and
real internal generators. External AI and Stripe calls are disabled in that
fixture. Local tests of simulated model output establish workflow contracts;
they do not establish the quality of a real custom generated application.

The complete local `npm run verify` passed: **466 tests, zero failures/skips**,
including 71 PostgreSQL integration checks, lint, type checking, existing
Exchange/creation checks and the production build. Evidence is preserved in
the enclosing workspace at `outputs/simplified-core-verification-oct9`.
The first attempt used the wrong local database port; after correcting the
disposable server startup, the complete suite passed. No hosted database was
used. This run covers the working copy; CI must bind the published candidate.

Local browser acceptance passed for Home request prefill without submission,
one-credit task-list creation, authenticated private preview, add/complete/
filter/search/clear/remove interactions, download, saved results after reload,
and a revision request with missing provider setup. That request retained the
draft and original app and charged nothing. Preview form handling needed
`allow-forms`; opaque-origin isolation and CSP `form-action 'none'` remain.

Downloaded HTML and ZIP index.html matched exactly (HTML SHA-256
`a4233e91b8e5ceb2f9915d3a1aed6654a5ed802e19bf3bca9212d38a66e0bca3`).
The exported app was served independently on localhost; a task survived reload
using browser storage. The original preview artifact predates the short-title
polish and is retained as evidence. No real AI custom generation is claimed.

Deployed staging evidence is still pending. This document does not establish a
public launch.

## Remaining public-release gates

1. Verify the simplified flow on the exact deployed staging version, including
   private file retrieval and owner isolation.
2. Accept real Responses app creation and a source-based revision within an
   approved budget. Try meaningful app interactions and preserve the original
   version. A ZIP that downloads is not proof of working software.
3. Resolve the existing restricted Stripe test key account-read permission and
   complete the new offer's purchase lifecycle. Historical legacy payment tests
   and new price display are separate evidence.
4. Establish the production hosting, backup/recovery and operating plan for the
   accepted scope. Live billing, main merge and public cutover remain separate.

TreEbay's fastest current web path retains its Base44 backend. Its migration
adapter is preserved for later; neither migration nor app-store submission is
part of the immediate launch path. Apocalypse remains deferred.
