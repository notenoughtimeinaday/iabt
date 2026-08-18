# Security

## Secrets

- Store `OPENAI_API_KEY` and other credentials only in Base44 backend secrets.
- Never commit `.env`, `.env.local`, Base44 tokens, or `base44/.app.jsonc`.
- Never expose backend secrets through `VITE_*` variables.

## Data access

Project and AI-usage records use owner-scoped row-level security. The AI generation function requires an authenticated Base44 user and enforces an hourly per-user request limit.

## Generated apps

IABT escapes user-authored content before placing it into HTML exports. Generated applications do not contain the IABT OpenAI key or Base44 service credentials.

Report suspected vulnerabilities privately to the repository owner. Do not include credentials, tokens, personal project data, or private exports in a public issue.
