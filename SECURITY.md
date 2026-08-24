# Security

## Secrets

- Store `OPENAI_API_KEY`, Stripe credentials, price IDs, and webhook secrets only in Base44 backend secrets.
- Never commit `.env`, `.env.local`, Base44 tokens, Stripe keys, webhook signing secrets, or `base44/.app.jsonc`.
- Never expose backend secrets through `VITE_*` variables.
- IABT billing defaults to Stripe test mode. Live mode is accepted only when `IABT_STRIPE_MODE=live` and the configured Stripe key, price IDs, and webhook endpoint are the corresponding live resources.

## Data access

Project and AI-usage records use owner-scoped row-level security. Account entitlements are readable by their owner and managed through administrator or verified backend workflows. The AI generation function requires an authenticated Base44 user and enforces per-user hourly safety limits plus monthly allowances. Purchased credits are stored on the administrator-managed entitlement and consumed only after the included allowance.

## Billing and supplier spend

- Checkout and Customer Portal functions require a signed-in Base44 user.
- Checkout selects price IDs from backend secrets; callers cannot submit arbitrary Stripe prices.
- Customer identity is taken from Base44 authentication and stored entitlement data.
- Redirects are constrained to known IABT origins.
- Webhook signatures use HMAC verification, constant-time comparison, and a five-minute timestamp tolerance.
- Webhook plan assignment is derived from configured Stripe price IDs, not client-supplied plan names.
- AI credit grants are idempotently recorded by Stripe event ID.
- Invalid and cross-app Stripe events are rejected. Test/live webhook events must exactly match the configured `IABT_STRIPE_MODE`; mode-mismatched events are rejected.
- Paid supplier work requires purchased production credits, a documented approved ProviderAgreement, a commercial-approval secret, the minimum margin floor, per-job limits, and daily/monthly spend capacity.
- Supplier commitments and settlements are recorded in an administrator-only ledger separate from customer IABT credit accounting.
- Public policy acceptance is versioned and owner-scoped. Material policy updates require a new version and renewed acceptance.

## Generated apps

IABT escapes user-authored content before placing it into HTML exports. Generated applications do not contain the IABT OpenAI key, Stripe credentials, or Base44 service credentials.

Report suspected vulnerabilities privately to the repository owner. Do not include credentials, tokens, personal project data, billing data, or private exports in a public issue.
