# IABT Project Context

## Canonical Base44 app

- Name: CreatorFlow (IABT implementation)
- App ID: `6a849bcd3e04d068553b4af7`
- Public URL: https://crazy-creator-flow-hub.base44.app
- Architecture: React/Vite + Base44 SDK/auth/entities/functions
- AppDefinition schema: 1.0

## Migration decision

The current app is Base44-native. The historical Node/Express implementation remains preserved as an immutable legacy baseline and is not modified by this repository.

## Preserved capabilities

Pages, components, routing, inspector editing, ScannerInput, local recovery, AI generation, project persistence, JSON import/export, HTML/ZIP exports, React exports, and live preview are all represented in the Base44 implementation.

## External setup

- Sign in through the Base44-hosted login.
- Optional: configure `OPENAI_API_KEY` and `OPENAI_MODEL` in Base44 backend secrets for direct OpenAI Responses API usage.
- Publish from Base44 after `npm run verify` passes.
- Do not change DNS without explicit authorization.

## Candidate domain

`iabt.insuredspending.org`
