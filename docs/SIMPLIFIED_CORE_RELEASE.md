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

The identical source tree was published as `793dd2d1cc89240047345f36cb97ae32fbbeb6d3`.
[CI run 691](https://github.com/notenoughtimeinaday/iabt/actions/runs/37908031471)
passed. Mobile follow-up retains every header action and restores the cost
disclosure below 480px; this is display-only. The Free plan no longer advertises
paused paid-media creation. CI runs 692 and 693 also passed. The API is Live at
`2030aff31bb5aa753da89b1e4e8b9bc4415d3ce0` (deploy `dep-db4arp3bc2fs73b7cpq0`);
the frontend is Live at `fb46b55ad1468eccfff94107a6e2be74efe07071` (deploy
`dep-db4b1qe7bikc73e5shvg`). The latter changes only preview ordering and the
accessible mobile Account label. Both services keep auto-deploy disabled.

Hosted acceptance created one task-list starter, saving HTML and ZIP to private
storage and charging exactly one existing test credit (498 to 497). Adding and
completing a task worked in the private preview. Downloads matched byte-for-byte
(HTML SHA-256 `89f0c6d5d9c58666ade3c4dad03c050e1b961214784a0cc96d7be22d299cde63`).
The saved result survived frontend deployment/reload without a second job or
charge. HTML preview now precedes its ZIP; mobile Account has an accessible name.

A custom revision quote failed explicitly because AI execution is disabled;
the original app, draft and 497-credit balance were preserved. Render's existing
paid-AI/orchestration switches are false and budgets zero. The existing OpenAI
key entry is masked and unverified. No real custom generation is accepted.
The owner has been asked to authorize up to $0.50 for one custom app and one
revision, with at most six calls and 6,000 output tokens per call per job. The
proposed budget is a per-job estimate, not a provider account hard cap. No paid
settings changed. This document does not establish a public launch.

## Remaining public-release gates

1. Extend the accepted hosted starter/private-download flow with cross-account
   owner-isolation checks and real-inbox registration/recovery acceptance.
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
