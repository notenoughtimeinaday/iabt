# IABT Exchange Beta

**Version:** `iabt-exchange-beta-2026-09-01.1`  
**Status:** Implemented in the canonical Base44-native IABT-JERICHO repository; not yet published as a public beta.

## Purpose

IABT Exchange is an opt-in professional collaboration and team-formation module. It helps a project owner identify missing capabilities, receive explainable matches against opted-in collaboration profiles, request a mutual-consent introduction, and work in a private collaboration room.

It is not a public contact directory, employment agency, broker-dealer, investment marketplace, bank, insurer, escrow service, money transmitter, fundraising platform, or guarantor.

## Product flow

1. A member creates a match-safe collaboration profile.
2. A project owner creates a project need or asks JERICHO to draft a capability-gap analysis.
3. IABT applies hard eligibility filters and a deterministic weighted match score.
4. The project owner reviews match-safe candidate cards and score breakdowns.
5. The project owner may request an introduction and select fields they agree to disclose after acceptance.
6. The recipient may accept or decline and independently choose their disclosure fields.
7. Acceptance creates a private collaboration room.
8. Either member may block or report the other; administrators review credential claims and safety reports.

## Privacy model

- Participation is opt-in.
- `match_only` is the recommended default visibility.
- There is no public contact directory.
- Match results never contain email, phone, legal name, or private project notes.
- Identity and contact details are disclosed only after a mutually accepted introduction.
- Each participant controls their own disclosed contact fields.
- Private project summaries may be disclosed by the project owner only through an explicit introduction-level choice.
- Declined, withdrawn, expired, or blocked introductions disclose no contact details.
- Blocks prevent future matching between the two accounts and may suspend active rooms.
- Safety reports are allegations pending administrator review, not automatic findings.

## Matching model

### Hard filters

A candidate is excluded before scoring when any of the following applies:

- The candidate is the project owner.
- The collaboration profile is inactive or private.
- The candidate is unavailable.
- Required relationship types are incompatible.
- Compensation preferences are incompatible.
- Required jurisdiction is not supported.
- A mandatory credential has not been verified.
- Either member has blocked the other.

### Disclosed deterministic weights

| Factor | Maximum points |
|---|---:|
| Required capability fit | 35 |
| Jurisdiction and verified credentials | 20 |
| Availability | 15 |
| Project-stage fit | 15 |
| Relationship and compensation fit | 10 |
| Verified reputation signals | 5 |
| **Total** | **100** |

No random selection is used.

## Implemented routes

- `/exchange` — member dashboard, profiles, needs, matches, introductions, rooms, credentials, and safety controls
- `/exchange/assistant` — conversational IABT Exchange agent
- `/exchange/rooms/:roomId` — private collaboration room
- `/admin/exchange` — administrator credential, safety, and audit center

## Implemented entities

- `CollaborationProfile`
- `ProjectNeed`
- `MatchRecord`
- `IntroductionRequest`
- `CollaborationRoom`
- `RoomMessage`
- `CredentialClaim`
- `ExchangeSafetyReport`
- `ExchangeAuditEvent`
- `ExchangeBlock`

## Implemented backend functions

- `get-exchange-dashboard`
- `save-exchange-profile`
- `analyze-project-needs`
- `save-project-need`
- `find-collaboration-matches`
- `request-introduction`
- `respond-to-introduction`
- `get-collaboration-room`
- `send-collaboration-message`
- `save-credential-claim`
- `block-exchange-user`
- `report-exchange-user`
- `get-exchange-admin`
- `admin-review-exchange`

## AI agent

`base44/agents/iabt_exchange.jsonc` defines a dedicated Exchange concierge. It must:

- Read current Exchange state before describing it.
- Preserve match-safe privacy boundaries.
- Explain deterministic match scores accurately.
- Require action-time approval before introductions, disclosure, messages, blocks, or reports.
- Treat credential claims as unverified until administrator review.
- Refuse to present Exchange as banking, insurance, brokerage, investment solicitation, pooled-fund administration, employment placement, or regulatory approval.

## Legal and policy integration

Policy version `2026-09-01.1` includes:

- Exchange data and disclosure practices in the Privacy Notice.
- Exchange limitations and diligence duties in the Terms of Use.
- Prohibitions on scraping, spam, misrepresentation, harassment, regulatory evasion, fraudulent fundraising, and prohibited financial activity.
- Dedicated collaboration, matching, consent, blocking, and credential provisions.
- Renewed in-app policy acceptance for the material update.

The policy text is a prelaunch product draft and requires review by appropriately licensed counsel before a public beta.

## Verification

`npm run verify` currently performs:

1. ESLint
2. JavaScript/TypeScript checking
3. `verify:exchange` deterministic matching and privacy tests
4. Vite production build

The Exchange verification covers:

- scoring weights and deterministic behavior
- self-match exclusion
- private-profile exclusion
- mandatory verified-credential exclusion
- match-safe profile projection
- consent-limited contact disclosure
- input sanitization and enum enforcement

All Exchange backend entry modules have also been parsed through esbuild successfully.

## Remaining release gates

- [ ] Perform an authenticated two-account end-to-end test.
- [ ] Verify profile create/update/activate using real Base44 accounts.
- [ ] Verify project-need create/update/analyze/activate.
- [ ] Verify matching with one eligible and one ineligible test profile.
- [ ] Verify introduction request, accept, decline, and withdraw paths.
- [ ] Verify field-level contact disclosure in a private room.
- [ ] Verify private messaging between two real accounts.
- [ ] Verify block, unblock, report, and administrator review paths.
- [ ] Verify administrator credential review and reputation-score effect.
- [ ] Configure transactional notifications for introductions and messages.
- [ ] Review privacy, acceptable-use, collaboration, credential, and regulated-activity terms with counsel.
- [ ] Decide which Exchange agent/tools to expose through App MCP.
- [ ] Publish only after owner approval and release-gate completion.
- [ ] Reconnect AI clients after any MCP tool publication changes.

## Security notes

- No production API keys belong in source files, prompts, entities, artifacts, or logs.
- Match-safe records and private profile/contact records remain separated by projection and server-side authorization.
- Service-role writes are available only through authenticated functions that verify ownership or participation.
- Do not seed fake public professional profiles in production.
- Do not charge transaction-based compensation for investment or securities introductions without separate legal classification and licensed infrastructure.
- The remaining `npm audit` findings require a separate dependency-migration decision because the automatic fixes are breaking changes; do not use `npm audit fix --force` without testing the full application.

## Release decision

This implementation is code-complete enough for controlled beta testing, but it is not yet approved for public publication. DNS, production publication, MCP exposure, transactional notifications, and legal release remain separate owner decisions.
