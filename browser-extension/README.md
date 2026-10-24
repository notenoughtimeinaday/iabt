# IABT Master Control 0.1.0 — development preview

Master Control gives Jericho a local browser side panel and an optional Windows computer-control companion. It is a separate prototype from the deployed IABT Studio. It does not replace the live app or complete arbitrary instructions with AI.

## What you can use

- Keep a goal, next steps, notes, saved page snapshots and small configurable tools together.
- Type commands or opt into browser dictation, review the transcription and press Run.
- Read an explicitly authorized web page; review one click or field fill at a time.
- Build and preview a checklist, notes panel, links collection or calculator. Change panel theme, text size and spacing, with undo.
- With the Windows companion, request cursor moves, clicks, double-clicks, right-clicks, selected-window text and common shortcuts. Each input gets its own default-No Windows confirmation.
- Save workspace revisions and activity to an encrypted local folder and search retained history.

The command interpreter is deliberately bounded: `goal Finish my catalog`, `step Confirm prices`, `note Call the nursery`, `open example.com`, `inspect page`, `use light mode`, `build a checklist`, `move cursor to 400, 300`, `click at 400, 300`, `scroll down 3 at 400, 300`. After selecting a window under Control, `type Hello world` and `press ENTER` also prepare reviewed actions. An AI planner that turns arbitrary goals into reliable multi-step procedures is **not implemented**.

## Install the extension

1. Extract the entire ZIP to a permanent folder. Keep its location stable.
2. In Chrome, open `chrome://extensions`; in Edge, open `edge://extensions`.
3. Enable Developer mode, choose **Load unpacked**, and select the extracted **extension** folder containing `manifest.json`.
4. Pin **IABT Master Control**. Click its toolbar icon while viewing an ordinary web page to open the panel and grant temporary access to that page.
5. Copy the extension's 32-letter ID from the extensions page. Install the companion below to keep work after the browser session ends.

Without the companion, a visible **Temporary session** label means workspace data is only in Chrome's session storage. It is not an encrypted persistent folder. Browser restart or extension reload/removal may erase it.

## Connect the Windows encrypted folder

The first native companion targets Windows 10/11, Chrome or Edge, and Windows PowerShell 5.1. Mac and Linux native input are not implemented. The extension itself can run in supported Chromium browsers, with temporary storage when no companion is installed.

1. Review `windows-companion/Install.ps1` and `NativeHost.cs`. This is an unsigned development build, not a store-reviewed release.
2. Open **Windows PowerShell** as your ordinary user, and change directory to the extracted `windows-companion` folder.
3. Run `./Install.ps1 -ExtensionId YOUR_32_LETTER_EXTENSION_ID`.
4. Read the installation prompt and type `INSTALL` only if you approve. The script compiles the included C# source, runs a noninteractive encryption self-test, restricts folder permissions, and registers the host for that exact extension ID in Chrome and Edge. It does not need administrator privileges or download dependencies. If an organizational execution policy blocks it, use an approved installation route; do not disable the policy.
5. Reopen the panel and choose **Control → Connect encrypted folder**. Confirm the green connected label. An existing encrypted workspace wins over temporary browser data; a new empty vault imports the current temporary workspace.

Data lives at `%LOCALAPPDATA%\IABTMasterControl\Vault`. `workspace.enc`, `history.enc` and action receipts use Windows DPAPI for the current Windows account. Only that account and SYSTEM receive folder access. There is no network listener, account signup, cloud database or provider credential in the companion. Windows administrators and software already running as you are outside this protection boundary.

## Permission checks and control limits

Web actions require a fresh inspection and a review button. The selected tab, document and control are rechecked; approvals expire and cannot be replayed. Recognized password, payment, send, submit and destructive controls require direct page use. Website handlers can have other effects, so review the actual target.

Native actions can reach ordinary applications outside the browser. Coordinate clicks can activate **anything at that point**, including consequential buttons: inspect the screen and approve only the exact requested action. Selecting a target window for typing verifies its handle, title and focus, but cannot identify the focused field inside every program. Never use this preview to type credentials. Native requests have a separate Windows confirmation even if the extension asks automatically. Held modifiers are rejected; uncertain dispatch is not automatically retried. Choose No to stop a pending request, or disconnect the companion to stop future access. There is no unattended action loop.

Windows elevation/UAC, secure desktops, browser-protected pages, application restrictions and changing layouts remain limits. A successful input dispatch does not verify the application result. There is no claim that it can click absolutely everything or safely perform any procedure.

## History, privacy and recovery

With the companion connected, saved workspace revisions and supported commands, inspection metadata, approvals, cancellations and action outcomes are retained in the encrypted log. The panel's short recent-activity list is not the full history; **Search encrypted history** returns up to 50 recent matches while older records remain. It does not watch unrelated browsing, continuously record screens or keep microphone audio. Text sent through native typing and page fills is omitted from action logs. Notes and saved page snapshots are content you explicitly choose to retain, so keep secrets out of them.

DPAPI encryption is tied to the Windows account. Copying encrypted files to another computer/account is not a portable restore. Keep account recovery and a trusted backup plan. Settings can export the **current workspace** as explicitly unencrypted JSON; that is not a full-history export. A portable encrypted backup/restore flow, full-history browsing/deletion controls and retention limits still need implementation. The log currently grows until you remove it or disk space runs out; a failed encrypted write stops the operation rather than quietly writing plaintext.

`Uninstall.ps1` disconnects native messaging after confirmation and preserves the Vault folder. Remove the extension separately. Keeping the extracted extension path stable preserves its ID; a different ID requires registering it again.

## Voice, customization and existing Jericho

Dictation is opt-in. Browser support varies, and its recognition provider may process audio remotely; the consent dialog explains that. Voice never automatically runs a command. Keyboard and OS dictation remain alternatives. Read-result speech uses available local voices only.

Tool definitions are validated JSON data, not downloaded executable code. They can customize the panel without adding permissions or rewriting the browser. Core extension/companion improvements must be tested and installed as reviewed source updates. Master Control cannot silently upgrade itself.

**Open Jericho Studio** shows the text to be shared first, then opens the existing Studio with a draft prompt. It does not submit a paid job, reuse browser cookies as API credentials, activate AI or bypass Studio's existing sign-in, payment and availability gates.

## Costs and verification

This local prototype makes no paid AI calls and provisions no subscription or cloud storage. Existing Studio usage keeps its existing costs and gates. Dictation depends on your browser/OS. Future AI planning and distribution would need a separate cost decision.

Run `npm ci --prefix browser-extension` and `npm test --prefix browser-extension` from the source repository. `npm run package --prefix browser-extension` builds this ZIP using Python 3. The Windows workflow compiles the companion and tests DPAPI, persistence and validation without moving the cursor. See `ACCEPTANCE.md` for the separation between tests and remaining real-device acceptance.
