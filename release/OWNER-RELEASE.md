# Jericho Studio 1.0 private release kit

Open START-HERE.html for the product presentation, proposed pricing and customer quick start. This is the full standalone Jericho product; IABT Lite / Italy is a separate template product and its purchase does not include future Jericho access. TreEbay and the separate unmerged MCP candidate are preserved outside this package.

The package is complete as an owner review and engineering handoff. It is not accepted for public sales. The software needs a running API, worker, PostgreSQL, private object storage and email provider; the frontend folder is not a standalone AI service or Windows installer. Base44 is not needed for this runtime.

## Contents and use

- `source.zip`: exact Git source snapshot. Extract into a new folder, install using both lockfiles (`npm ci` and `npm ci --prefix server`), and follow README.md and STANDALONE_DEPLOYMENT.md. Preserve existing workspaces and settings.
- `frontend/`: a compiled, hash-routed preview targeting the isolated staging API. Host over HTTP(S), not by opening index.html directly. Rebuild for a different API origin. No production endpoint is selected.
- `THIRD-PARTY-NOTICES.txt`: installed dependency license metadata and available license text. This preserves dependency notices; it does not grant new rights to IABT source or certify supplier-generated content.
- `product.json`: scope, price proposal and unresolved acceptance gates.
- `manifest.json`: source revision, file sizes and SHA-256 checksums. Verify the archive before using it; never package live environment files or account backups into a customer distribution.

## Current blocker, October 15

The existing Neon free project reports 6,245,714,826 transfer bytes for October and rejects connections with a quota error. The API logs show the same failure. The compute was suspended October 15. Neon's documented free public transfer allowance is 5 GB/project/month; exceeding it suspends compute until the next billing cycle or upgrade. The reported next cycle begins November 1 UTC.

Current official Launch pricing is usage-based: $0.106/CU-hour, $0.35/GB-month database storage and $0.20/GB-month history, with 500 GB/project/month public transfer included. There is no monthly base minimum. At the existing fixed 0.25 CU, continuously active compute alone is about $19.35 per 730-hour month; storage, other projects and other services are additional. This is an estimate, not a hard cap. Upgrading an organization can affect its other projects. Review the exact account billing screen before committing.

Sources checked October 15: https://neon.com/pricing and https://neon.com/docs/introduction/network-transfer . A restart, API-key change or source ZIP cannot reset an exhausted allowance. Do not create another free project to bypass the quota, switch billing modes, or discard existing data. Diagnose repeated/wide reads after access returns before increasing traffic; the observed aggregate does not establish which query consumed it.

## Final launch sequence

1. Restore database availability under an owner-approved infrastructure budget. Verify login, saved work and private downloads against the existing accounts. Keep paid generation off during recovery.
2. Reconcile previous paid test usage and plans. Accept one useful custom app, its owned-source revision and an original document within a specifically approved remaining test allowance. Test every requested workflow in a browser, persistence/import/export where requested, mobile layout and download integrity. Preserve originals and record exactly-once credits. Do not repeat prior completed sandbox purchases.
3. Finish hosted account recovery, isolation and backup/restore evidence. Confirm support mailbox delivery. The outage fix itself does not prove these flows.
4. Prepare a separate production data/billing environment. Staging is permanently test-bound; never convert test-funded credits to live credits. Complete current checkout terms, introductory eligibility, renewal/cancellation/refund, taxes and actual customer delivery acceptance. The new-offer implementation currently rejects live mode and needs a reviewed production activation change after acceptance.
5. Approve production configuration, source revision and commercial terms, then publish. Only then replace the private-preview label and open sales. No ongoing hosting or AI capacity was purchased by creating this kit.

## Preserve completed work

Baseline e94a01a and CI 704 are reused. Earlier sandbox subscription/top-up evidence and recovery ZIPs remain intact. The October 15 tracker delivery was incomplete; it must not be shown as a successful customer benchmark. The latest source checks reject missing supported requirements and broken inline JavaScript but do not execute generated applications.

The additional change in this kit replaces invisible startup failure with an accessible connection/retry screen. Retrying only checks account state; it never recreates jobs or payments. Help and policies remain accessible during an outage. Local tests and browser evidence are recorded separately from deployed acceptance in docs/CURRENT_RELEASE_STATUS.md.
