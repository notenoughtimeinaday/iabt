# IABT Master Control acceptance record

Development candidate, 2026-10-24. Derived from standalone IABT commit `dcb59fd4f97ba8de4131e6f3abbaa915717560a8` on separate branch `work/iabt-master-control`. Base44 is not a runtime dependency of this extension or native companion. The deployed Studio is unchanged.

## Automated evidence

The extension tests run the real parser, workspace controller, DOM action functions and rendered tool/panel code using local fixtures. They cover sender restrictions, single-use approval, expiry, tab/document/control changes, sensitive-control refusal, encrypted-host routing, failure without plaintext fallback, temporary-session labeling, tool validation, injection-safe rendering, goal save, appearance change and interactive checklist installation/use. Fixture tests are not a real browser installation or microphone test.

The Windows CI job compiles the actual companion source under Windows PowerShell and executes `--self-test`. It verifies DPAPI round trip, encrypted persistence/history, action allowlist and a guard preventing interactive control during tests. A configured workflow is not a passing run: inspect the linked commit's Actions result before treating it as evidence. It does not install native messaging or exercise cursor/keyboard input.

The root repository verification is separate from extension/native checks. Local PostgreSQL-dependent skips are not a pass of database integration. The existing repository CI supplies a disposable PostgreSQL service. Production health, billing, provider output and customer acceptance are not established by either suite.

## Required device acceptance before everyday or public use

1. Load the unpacked extension in the user's actual Chrome/Edge and verify side-panel layout, keyboard navigation, narrow width, zoom, light/dark appearance and temporary-access prompts.
2. Install the companion as the ordinary Windows user. Verify the exact extension ID, folder ACL, encrypted bytes, connected label and persistence after closing/restarting both browser and Windows. Verify a second Windows account cannot decrypt the folder.
3. Use an empty test document and an innocuous button fixture: reject a native request and observe no input; approve one move/click, one text entry and one shortcut. Verify the target, focus, Windows dialog, event record, response and actual application result. Test cancelled, stale and repeated requests, multi-monitor/DPI coordinates and held modifiers. Do not test against purchases, messages, account permissions or destructive controls.
4. Verify browser page inspection and confirmed nonconsequential click/fill in the actual browser; changing documents or controls must invalidate approval. Verify protected pages and recognized sensitive controls stay manual.
5. Try the microphone only after consent, verify denied/unsupported recognition has an accurate fallback, and confirm transcript review is required. Verify local read-result voices separately.
6. Verify reconnect, disk-full/write errors, process interruption, log growth and restore procedures. Portable encrypted recovery, full-history management and installation signing are unresolved product work.

## Not implemented / not accepted

- Arbitrary-goal AI planning, visual grounding, autonomous procedure execution or outcome recognition.
- Automatic reuse of Studio account history, API sessions or AI credits.
- Silent privilege changes, remote executable extensions or self-rewriting core code.
- Mac/Linux native companion, mobile control, protected/elevated Windows control.
- Public store release, signed installer, ongoing support, commercial readiness or public paid AI authority.

The next product milestone is one verified real-device task from spoken/typed goal through specific permission approval, actual interaction, outcome verification and encrypted history recovery. Low-level input dispatch alone does not meet that milestone.
