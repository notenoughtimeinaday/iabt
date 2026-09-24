# Continuous repository verification

The existing `IABT verification` workflow runs the complete `npm run verify`
contract against a disposable local PostgreSQL 16 service and preserves
`readiness.json` plus `readiness.md` as GitHub Actions artifacts. The token has
read-only repository permissions, checkout does not persist credentials, and no
production credentials or paid API keys are configured for this job.

Pull-request events provide an executable verification path for the unmerged
`jericho-autonomy-v1` branch. An existing run can also be rerun in Actions. A
daily 08:37 UTC schedule and manual dispatch event are checked in, but **the
schedule is not active while this workflow revision is only on the unmerged
branch**. GitHub schedules run the default branch. The manual-run UI likewise
depends on the default-branch workflow; do not claim dispatch availability until
an actual run confirms it. After reviewed default-branch adoption, observe the
first scheduled run before considering unattended repository checks active.

These constraints come from GitHub's [workflow-event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
and [manual-dispatch reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).
Scheduled Actions can be delayed or dropped. They are verification evidence,
not an always-on production worker or a guaranteed execution schedule.

## Local execution

Install root and server dependencies, configure only a disposable **local**
PostgreSQL test database, then run:

```sh
npm run readiness
```

The runner invokes the existing `npm run verify` once. Its own tests are in
`verify:readiness`, so there is no recursive verification invocation. On a
machine without an npm installation alongside Node, provide its actual CLI:

```sh
node scripts/jericho-readiness.mjs --npm-cli /path/to/npm/bin/npm-cli.js --git /path/to/git
```

Reports default to `.jericho/reports/`, which is ignored by Git. `--output-dir`
selects another report directory. The command returns nonzero when repository
verification fails or cannot establish completion. Missing PostgreSQL evidence
remains an explicit unknown gate even if the remaining suite passes.

The subprocess receives an allowlist of basic runtime settings, a synthetic
standalone build origin and the validated disposable test database address.
Production service tokens, model keys and `NODE_OPTIONS` are not forwarded.
The report contains fixed check identifiers, statuses, numeric counters, source
commit information and output hashes. It contains no raw test output, stack
traces, environment values, database address, source-file contents or provider
responses. To investigate a failure, run the reported fixed check locally with
the same disposable test configuration; a digest cannot explain a failed test.

## Evidence contract

Each repository check is `passed`, `failed` or `unknown` based on the actual
ordered npm-script boundaries and exit result. Checks after a stopped command
remain unknown. PostgreSQL coverage additionally requires a validated local
test configuration and observed executed PostgreSQL tests; skipped tests do not
establish coverage. Git is inspected before and after verification. A dirty,
changing or unknown checkout cannot establish verification of an exact commit.

External acceptance requirements are an explicit versioned registry inside the
runner. The report always leaves these unknown: real account/inbox access,
deployed file journeys, worker recovery, Stripe test lifecycle, migration
reconciliation, backup plus object retrieval, authorized live Responses use,
generated-code behavior and repair, advertised file-format understanding,
two-account privacy, continuous hosting, and release/rollback acceptance.

Passing source checks or finding a module does not promote these requirements.
The report grants no deployment, purchase, account access, repository-write or
external-message authorization. A production release must combine this
commit-specific regression evidence with separately recorded staging
acceptance. The runtime maintenance engine has its own persisted scheduling
and evidence; this CI file alone does not cause Jericho to keep executing work
after the editor closes.
