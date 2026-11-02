# Jericho Personal 1.2

A simpler phone workspace for keeping and running your own HTML apps, notes and checklists. No Jericho subscription or API key is required.

## Everyday use

1. Back up your projects in the old version. Install `Jericho-Personal-1.2.apk` over the existing app; do not uninstall it. The package/signing identity is preserved and versionCode is 3.
2. Describe what you want on the home screen. Tap **Send to my assistant** and choose an assistant app in Android's share sheet. Send the request in that app. Your chosen assistant's account, availability and usage limits still apply.
3. Ask the assistant to return a complete single-file HTML app. Download that HTML file, return to Jericho, tap **Open my result → Choose downloaded app**. You can alternatively paste the complete HTML under **Paste app code instead**.
4. Jericho saves a new copy and opens the app directly. Use **Ask for a change** to share a revision request and the selected source. Bring the new result back the same way; originals are retained.
5. Back up regularly. Project backups contain source, notes and saved app data as plain JSON; keep them private. App exports contain HTML source, while full backups preserve in-app saved data. Uninstalling or clearing app data deletes local projects.

This is an explicit share-and-return workflow, not a built-in ChatGPT API, automatic response delivery or a bundled AI model. No message is sent merely by opening a project. Sharing is initiated by your tap and completed in the app you choose. If no suitable assistant accepts shared text, use the assistant you already have and import its returned HTML file. Jericho itself does not provide an external assistant account or unlimited free AI.

Offline checklists, notebooks, file imports and optional computer AI are under **Offline tools & options**. Computer AI is optional, separate, and still requires an installed local Ollama model and trusted-LAN setup. Its first eligible installed model is selected automatically; you do not need to find a model number. `Start-Jericho-Local-AI.ps1` retains the earlier reviewed setup path without changing firewall/router settings or installing models.

## Saved app data

HTML projects open in Run mode; Code is a separate tab. A bounded localStorage shim supplies only that project's saved key/value data to the sandboxed app. Writes are accepted only from the active frame and matching nonce. Other projects, parent storage, network access, top navigation and native save/model/share prompts are not granted to imported code. The shim supports localStorage getItem/setItem/removeItem/clear/key/length, up to 100 keys and 200,000 serialized characters per app. It does not supply IndexedDB, remote APIs, storage events or arbitrary browser integrations. Apps must actually use these storage methods to retain their state. Source/backups/data bounds remain enforced; quota failures retain edits in memory with a warning rather than claiming they were saved.

## Build and evidence

Use `build.py` with Android platform/build tools 35, Java 17+, ECJ, and the private original signing identity. Never commit signing keys or passwords. The updated native wrapper supports user-initiated ACTION_SEND text sharing from the bundled trusted asset only. Generated previews retain an opaque sandbox origin and blocked networking. Existing explicit native private-LAN model access remains separate.

`test-simple.mjs` exercises the new handoff payload, fenced HTML result import, preview-first opening, persistent per-app storage across reload and project isolation on an offline 390px browser. Existing `test-browser.mjs` and `test-local-ai.mjs` cover the older offline tools and optional model workflow. These use a synthetic native prompt bridge; actual Android share-sheet compatibility, installation, file picker and lifecycle still need device acceptance. Compilation, APK signature/alignment and certificate continuity are checked separately. No claims of arbitrary app correctness or seamless autonomous phone AI follow from these checks.

The private recovery ZIP includes source and the existing signing identity for future updates. Keep it private. Production services, billing and model-provider settings are unchanged.
