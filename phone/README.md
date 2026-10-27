# Jericho Personal — Android offline edition

A separately installed, free personal tool. Package `org.insuredspending.jerichopersonal`, version 1.0-personal, Android 8+ (minimum API 26, target API 35). It does not replace the hosted Jericho app or access its accounts. There is no subscription, AI credit system or provider call in this edition.

## Use on a phone

Download `Jericho-Personal-1.0.apk`, open it in Android Files/Downloads, and follow Android's installation prompts. It is a privately signed personal APK, not a Play Store release. Do not disable Play Protect. Installation and native WebView/file-picker behavior still require acceptance on your actual device.

Create a project and choose Checklist, Notebook, or HTML app. Checklists and notebooks work directly inside the app and save on the device. HTML projects have a code editor, an isolated script-enabled preview and HTML export. Import a single HTML/text file or a version-1 personal JSON backup. Existing projects are retained; replaying an unchanged backup deduplicates it, and conflicting IDs become restored copies. All imports validate before a batch is applied. Use your keyboard's microphone for dictation if desired; Jericho requests no microphone permission.

Export app/text opens Android's document picker. Choose a destination and save. Back up all exports the complete project library, including source and notes, as plain JSON. Keep backups private. App data is not cloud-synced, and uninstalling/clearing storage removes it. Storage failures show a persistent warning and keep edits in memory; export before closing. Unreadable original storage is protected from overwrite during that session.

This is a useful local tool/editor, not an offline general AI programmer. It does not fetch GitHub repositories, import the consolidated source-reference catalog, run server projects, control other apps, or turn arbitrary spoken requests into software. Generated checklist/notes exports are named templates. An HTML preview has temporary state and no network access; its code cannot access the workbench's saved projects. Exports are separate copies. Review arbitrary imported HTML before using it outside the isolated preview.

## Build and verify

Source: `assets/index.html` and `src/org/insuredspending/jerichopersonal/MainActivity.java`.

Requires Android SDK platform 35/build-tools 35.0.0, Java 17+, Eclipse ECJ 3.40.0, and the existing private signing key. `build.py` makes no network call and refuses a missing signing password. Configure `JERICHO_PHONE_SIGNING_PASSWORD` privately; never commit the key or password. Invoke `python3 phone/build.py --build-tools PATH --android-jar PATH --ecj PATH --keystore PRIVATE_PATH --out OUTPUT.apk`.

The native wrapper has no INTERNET, microphone, camera, contacts or broad storage permission. File access is user-selected through Android's document picker. There is no JavaScript interface exposed to frames. Native save prompts are accepted only from the bundled top-level asset URL. Remote loads and cross-file universal access are disabled; imported previews retain an opaque sandbox origin with no top navigation or file download permission. JavaScript syntax and APK signature checks do not prove a complete security audit or physical-device acceptance.

Browser acceptance: install Playwright in a separate test environment and run `node phone/test-browser.mjs`, optionally setting `JERICHO_PLAYWRIGHT_MODULE` and `JERICHO_BROWSER_EXECUTABLE`. It exercises real offline file loading, phone layout, task persistence, empty-list persistence, Unicode notes, backup replay, source preview interaction and isolation, exported app behavior and native-export payload encoding. Native compilation, DEX packaging, APK signatures (v2/v3), resource manifest and ZIP alignment are verified separately. Actual Android install, document picker, storage lifecycle and keyboard dictation remain device checks. There is no current-head GitHub CI evidence for this edition yet.

A private recovery package preserves the source, APK and signing materials for future updates. Keep that recovery copy private. Updates must use the same signing key and a higher versionCode; export a backup before any uninstall or replacement. Do not re-sign with a new identity over an existing install.
