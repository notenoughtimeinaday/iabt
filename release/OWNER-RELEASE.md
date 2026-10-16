# Jericho Studio 1.0 private release kit

Open START-HERE.html for the product presentation, proposed pricing and customer quick start. This is the full standalone Jericho product; IABT Lite / Italy is a separate template product and its purchase does not include future Jericho access. TreEbay and the separate unmerged MCP candidate are preserved outside this package.

The package is complete as an owner review and engineering handoff. It is not accepted for public sales. The software needs a running API, worker, PostgreSQL, private object storage and email provider; the frontend folder is not a standalone AI service or Windows installer. Base44 is not needed for this runtime.

## Contents and use

- `source.zip`: exact Git source snapshot. Extract into a new folder, install using both lockfiles (`npm ci` and `npm ci --prefix server`), and follow README.md and STANDALONE_DEPLOYMENT.md. Preserve existing workspaces and settings.
- `frontend/`: a compiled, hash-routed preview targeting the isolated staging API. Host over HTTP(S), not by opening index.html directly. Rebuild for a different API origin. No production endpoint is selected.
- `THIRD-PARTY-NOTICES.txt`: installed dependency license metadata and available license text. This preserves dependency notices; it does not grant new rights to IABT source or certify supplier-generated content.
- `product.json`: scope, price proposal and unresolved acceptance gates.
- `manifest.json`: source revision, file sizes and SHA-256 checksums. Verify the archive before using it; never package live environment files or account backups into a customer distribution.

## Current acceptance, October 16 UTC

The owner-approved Neon Launch activation restored the existing database and accounts. Isolated staging deployed `faa3a6e`; CI 709 and 543 local tests passed. Three private GPT-5.6 Terra checks delivered a volunteer planner, a source-bound revision and a 781-word original guide in Markdown, Word and PDF. The revision repaired empty-state persistence and date/import validation and added priority filtering. Browser checks covered add/edit, search/filter, completion, totals, confirmation, JSON round trip and mobile layout. One pale helper-text line remains a generated-app visual defect; this is not universal app-quality acceptance.

Provider usage across the earlier and replacement tests is conservatively estimated at $0.5156508 against the approved $9.90 existing balance. No funds were added. Paid generation and orchestration are off again; the plan allowlist is empty and cleanup deployment `dep-db8piuon74is73cc2c2g` is live. Each replacement test captured its 54-credit staging quote once. This deliberately conservative test profile is not approved customer pricing. Calibrate credit quotes before opening sales.

The latest local exporter improvement gives PDFs clear heading hierarchy, bounded lines and paragraph-aware pagination. It does not recompose text or call an AI provider. Its deployment and re-export evidence must be recorded separately from the three original AI deliveries. Original outputs and histories remain intact.

Current official Launch pricing is usage-based: $0.106/CU-hour, $0.35/GB-month database storage and $0.20/GB-month history, with 500 GB/project/month public transfer included. There is no monthly base minimum. At the existing fixed 0.25 CU, continuously active compute alone is about $19.35 per 730-hour month; storage, other projects and other services are additional. This is an estimate, not a hard cap. Upgrading an organization can affect its other projects. Review the exact account billing screen before committing.

Sources checked October 15: https://neon.com/pricing and https://neon.com/docs/introduction/network-transfer . Compute endpoints and project defaults are capped at 0.25 CU. This limits compute size, not the total organization bill; storage and other metered resources remain additional. Transfer-reduction changes are deployed but a new billing interval is needed to measure their effect. Do not discard existing data or create replacement projects to evade quotas.

## Final launch sequence

1. Preserve restored database availability, existing account continuity, saved work and private downloads. Keep paid generation off outside a specifically bounded authorized window.
2. Retain the completed private app/revision/document evidence; close the remaining generated-output visual defect and pricing calibration. Do not repeat completed paid jobs or prior sandbox purchases. Review additional outputs within their actual scope before making broad quality claims.
3. Finish hosted account recovery, isolation and backup/restore evidence. Confirm support mailbox delivery. The outage fix itself does not prove these flows.
4. Prepare a separate production data/billing environment. Staging is permanently test-bound; never convert test-funded credits to live credits. Complete current checkout terms, introductory eligibility, renewal/cancellation/refund, taxes and actual customer delivery acceptance. The new-offer implementation currently rejects live mode and needs a reviewed production activation change after acceptance.
5. Approve production configuration, source revision and commercial terms, then publish. Only then replace the private-preview label and open sales. No ongoing hosting or AI capacity was purchased by creating this kit.

## Preserve completed work

Baseline e94a01a, subsequent quality repairs and CI 709 are preserved. Earlier sandbox subscription/top-up evidence and recovery ZIPs remain intact. The earlier October 15 tracker delivery was incomplete; it must not be shown as a successful customer benchmark. Static source checks reject missing supported requirements and broken inline JavaScript but do not execute generated applications. Manual browser evidence applies only to the exact downloaded hashes reviewed.

The additional change in this kit replaces invisible startup failure with an accessible connection/retry screen. Retrying only checks account state; it never recreates jobs or payments. Help and policies remain accessible during an outage. Local tests and browser evidence are recorded separately from deployed acceptance in docs/CURRENT_RELEASE_STATUS.md.
