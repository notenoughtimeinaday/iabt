# IABT — Interactive App Builder Tool

IABT is an AI-assisted SaaS app builder running on Base44. It preserves the original IABT AppDefinition workflow while replacing the localhost-only Express runtime with Base44 authentication, owner-scoped cloud entities, backend functions, and hosting.

Live app: https://crazy-creator-flow-hub.base44.app

## What works

- Authenticated Base44 project dashboard
- Cloud create, load, save, rename, duplicate, delete, and search
- Recovery of unsaved local drafts
- User-controlled migration of legacy `iabt.projectsIndex` projects without deleting local originals
- Multi-page visual editor with page add, rename, duplicate, delete, and reorder
- Text, Input, Button, and ScannerInput components
- Component selection, inspector editing, deletion, reorder, undo, and redo
- Page routing and live phone/tablet preview
- Keyboard-wedge barcode/QR scanning; Enter dispatches a bubbling `iabt:scan` event
- AI AppDefinition generation through a protected, rate-limited Base44 function
- JSON import/export
- Standalone HTML, static multi-page HTML ZIP, React source, and runnable Vite/React ZIP exports
- Browser-generated ZIPs with no temporary server filesystem
- Responsive desktop/mobile editor

## Architecture

- React + Vite frontend
- Base44 SDK and Vite plugin
- Base44 authentication
- Owner-scoped `Project` and `AiUsage` entities
- Deno backend function at `base44/functions/generate-app/entry.ts`
- AppDefinition schema version 1.0
- Local draft recovery plus Base44 cloud persistence

The AI function uses `OPENAI_API_KEY` and the OpenAI Responses API when that secret is configured. Without it, the function falls back to Base44 managed AI, so generation remains usable.

## Local development

1. Install dependencies: `npm install`
2. Run the Base44 development environment: `npx base44 dev`
3. Or run the frontend against the hosted backend: `npm run dev`

For frontend-only development, create `.env.local`:

```
VITE_BASE44_APP_ID=6a849bcd3e04d068553b4af7
VITE_BASE44_APP_BASE_URL=https://crazy-creator-flow-hub.base44.app
```

Never place an OpenAI key in a `VITE_*` variable or frontend file.

## Verification

Run:

```
npm run verify
```

This runs lint, JavaScript project validation, and the production Vite build. Export verification should also generate both ZIP targets and build the exported React project.

## Base44 setup

- Enable the intended authentication providers in the Base44 dashboard.
- Optional: add `OPENAI_API_KEY` and `OPENAI_MODEL` through Base44 backend secrets.
- Publish only after `npm run verify` passes.
- The generated public address is already available at the live app URL above.

## Domain

The candidate custom domain is `iabt.insuredspending.org`. No DNS change is included or authorized by this repository.

## Historical baseline

The immutable Legacy Baseline v1.0 remains a separate recovery artifact. Do not overwrite it with this Base44-native implementation.

## GitHub

The repository includes a GitHub Actions verification workflow. Connect one canonical repository to this Base44 app and protect `main` after the first successful workflow run.
