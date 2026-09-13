# MnemoScript

A calm, local-first writing studio for novelists and worldbuilders. One codebase ships to **Windows /
macOS / Linux** (Tauri 2 desktop), **Android** (Tauri mobile) and the **web** (browser build with a
localStorage backend).

- **Write** — TipTap rich-text editor with a Word-style smooth caret, slash `/` blocks, images,
  to-do lists, spelling & grammar suggestions, read-aloud (karaoke highlight) and fully offline
  dictation (Silero VAD + Whisper in a Web Worker).
- **Organise** — projects are plain folders on disk; nested directories, drag-and-drop, multi-select,
  cut/copy/paste, six colour themes, typography controls.
- **Plan** — mind maps (React Flow, tidy-tree / free layouts) and a fantasy **map studio** (Konva):
  procedural terrain, land/sea brushes, regions with tiers, roads & rivers, labels, hand-drawn or
  classic art styles, PNG export.
- **Publish** — compile chapters into a PDF book (cover, table of contents, ordering).

**Install:** [docs/INSTALL.md](docs/INSTALL.md) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Change history: [docs/DEVLOG.md](docs/DEVLOG.md) ·
Roadmap: [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) · Tests: [docs/TESTING.md](docs/TESTING.md) ·
Map studio: [docs/FANTASYMAP.md](docs/FANTASYMAP.md) · Android: [docs/ANDROID.md](docs/ANDROID.md)

## Getting started

Prerequisites: Node.js 20+, Rust (stable), and on Windows the MSVC build tools.

```bash
cd app
npm install --legacy-peer-deps   # TipTap peer ranges need the flag
npm run dev:tauri                # desktop app with hot reload
```

Web preview without Tauri (browser backend, data in localStorage):

```bash
npm run dev                      # http://localhost:1420  (add ?shell=mobile for the phone UI)
```

Optional offline speech assets (dictation): `npm run setup:speech` and `npm run fetch:model`.

## Verify before committing

```bash
npm run check                    # lint → type check → unit + regression tests → build
cd src-tauri && cargo test       # backend tests (needs app/dist from the build above)
```

CI runs the same steps on every push (`.github/workflows/ci.yml`); tagged desktop releases are built by
`.github/workflows/build.yml`.

## Installing on Windows

Run `npm run build:tauri` (or download a release) and you get, under
`app/src-tauri/target/release/bundle/`:

| File | What it is |
|---|---|
| `nsis/MnemoScript_2.0.0_x64-setup.exe` | **Recommended.** Setup wizard: installs per-user (no admin prompt) into `%LOCALAPPDATA%\MnemoScript`, creates Start-menu **and** desktop shortcuts, and registers an uninstaller in *Settings → Apps → MnemoScript*. |
| `msi/MnemoScript_2.0.0_x64_en-US.msi` | Same app as a Windows Installer package (for IT deployment / `msiexec /i`). |
| `MnemoScript.exe` (in `target/release/`) | Portable build — runs without installing. |

Double-click the setup `.exe`, click through the wizard, then launch **MnemoScript** from the Start menu
or the desktop shortcut. Windows 11 already ships the WebView2 runtime the app uses; on a machine
without it the installer downloads it silently.

To uninstall: *Settings → Apps → Installed apps → MnemoScript → Uninstall*. Your writing is stored
outside the app in `%USERPROFILE%\.mnemoscript\projects` (or any folder you picked), so it survives
uninstalling, reinstalling and upgrading.

Silent install (scripted rollout): `MnemoScript_2.0.0_x64-setup.exe /S`.

## Installing on Android

`npm run android:build -- --apk --debug` produces a self-signed test APK at
`app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
Copy it to the phone, allow "install unknown apps" for your file manager, tap the APK, and confirm
Play Protect's "install anyway". (A Play-Store release needs a signing keystore; see docs/ANDROID.md.)

## Building

```bash
npm run build:tauri              # desktop installers → src-tauri/target/release/bundle
npm run android:build            # APK / AAB (see docs/ANDROID.md for the one-time SDK setup)
```
Build outputs are also copied to `release/` at the repository root (git-ignored).

## Where your data lives

A project is a folder (`~/.mnemoscript/projects/<id>` by default, or any folder you choose):

```
<project>/
  project.json          # metadata, folders, document index (no bodies)
  documents/<id>.json   # one file per document (the source of truth)
  assets/               # imported images
  exports/              # rendered maps (Android)
```

All writes are atomic; a corrupt document file is skipped rather than blocking the project.

## License

Proprietary – all rights reserved.
