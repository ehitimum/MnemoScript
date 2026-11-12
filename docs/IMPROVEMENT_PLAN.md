# MnemoScript — Codebase Status & Improvement Plan

_Assessed 2026-09-11 on branch `v1_stable_UI` (HEAD `1a4535f`); shipped as v2.0.0 on `v2_stable_UI`. Companion to
[ARCHITECTURE.md](./ARCHITECTURE.md) (how it's built) and [DEVLOG.md](./DEVLOG.md) (what changed)._

## 1. Where the codebase stands

**MnemoSync (2026-11-12):** development starts from the integrated AI feature HEAD. Strategy,
ADRs and security/test gates: [MNEMOSYNC_ARCHITECTURE.md](./MNEMOSYNC_ARCHITECTURE.md).
First deliverable is native checked backup/restore with existing desktop/phone settings styling;
then SQLite/IndexedDB and portable assets, Smart Merge, shared replay engine, LAN, Drive, hybrid
and recovery UX. The Android/installed-app gate remains pending until actual device evidence.

**Implemented Phase 0 slice:** native ZIP backup/restore, corruption/path/size validation, fresh
recovered copies and asset relocation, with desktop/phone settings controls. Automated checks
pass (130 frontend, 41 regression, 56 backend tests; lint/types/build/check/Clippy).
No transport or existing-project linking is enabled. Finish manual device acceptance before
advancing the Phase 0 gate; the following schemas remain design-only.

**Google Drive sync (2026-11-13, `codex/mnemosync-drive`):** implemented the shared sync engine
(entity revisions, SQLite state, merge/conflicts, staged open-chapter updates, portable images),
the Drive `appDataFolder` transport, desktop loopback+PKCE sign-in with keychain storage, Android
native authorization, and the sync UI for both shells ([MNEMOSYNC_DRIVE.md](./MNEMOSYNC_DRIVE.md)).
Automated checks pass; **live Google sign-in and real desktop ↔ Android sync are not yet verified**
(needs the writer's own OAuth clients). Still open: Smart Merge, LAN, web sync, history pruning.

| MnemoSync phase | Status |
|---|---|
| 0 Strategy + checked backup/restore | ✅ code; device acceptance pending |
| 1 Sync state + portable assets | ✅ native SQLite + `mnemo-asset:` refs; web IndexedDB not done |
| 2 Smart Merge | ⏳ not started (downloads create separate copies; same-name notice only) |
| 3 Revision engine + transport interface | ✅ with multi-device simulations |
| 4 LAN (MnemoLink) | ⏳ not started |
| 5 Google Drive | ✅ code + tests; live OAuth/device proof pending |
| 6–8 Hybrid, recovery UX, hardening | ⏳ partial (conflict review, notices) |

**Stack:** Tauri 2 (Rust) · React 19 + TypeScript 6 · Vite 8 · Tailwind v4 · TipTap 3 · React Flow 12 ·
Konva 10. Three targets share one codebase: Windows desktop (WebView2), Android (Tauri mobile), and the
web build (browser fallback backend in `lib/api.ts` → localStorage).

**Baseline before this pass**

| Check | Result |
|---|---|
| `tsc -b` | clean |
| `cargo check` | clean |
| `npm run lint` | **50 errors** (React Compiler `refs`/`set-state-in-effect` rules; vendored `public/ort/*.mjs` was being linted) |
| `vite build` | ok (2 chunks > 500 kB: main bundle, map studio) |

**Feature inventory** — projects/documents on disk (atomic writes were missing), rich-text editor with
slash menu / images / to-dos / grammar (LanguageTool) / read-aloud / offline dictation, folder tree explorer
with drag-and-drop, mind map (React Flow + dagre layouts), fantasy map studio (Konva; procedural terrain,
brushes, regions, routes, labels, two art styles, PNG export), PDF book compiler, six themes, a separate
phone shell.

**Systemic weaknesses found**

1. *Typing feel.* The Word-style smooth caret (from commit `99b50a4`) was a React-state overlay that
   re-rendered the whole editor (including a 200-line inline `<style>` block) on every keystroke, and had
   been switched off on mobile for that reason. On desktop it still ran but the editor also re-serialised
   the document twice per keystroke.
2. *Data loss paths.* Switching documents with unsaved edits stranded them in memory; the canvases
   (mind map / fantasy map) dropped their last 400 ms of edits on unmount; Save on a canvas could save
   stale content; the Rust layer wrote files non-atomically; `project.json` duplicated every chapter's
   full content on each folder change.
3. *Shell selection by width, not platform.* A desktop window narrower than 768 px flipped into the
   phone UI; a phone browser with a fine pointer could get the desktop UI.
4. *Map studio on touch.* Brushes, regions and routes never started on a phone (Konva does not synthesise
   mouse events from touch; the code relied on `tap`, which only fires on release). PNG export used
   `<a download>`, which does nothing inside the Android WebView.
5. *Correctness lint.* 50 React-Compiler violations (refs read during render, state set inside effects)
   are the kind that cause "component doesn't update" bugs.

## 2. What this pass changed (done)

### Editor & typing (all platforms)
- **`SmoothCaret.tsx`** — new ref-driven caret overlay (no React state, one rAF per change, GPU
  `transform`, content-space coordinates so scrolling/drawers can't dislodge it, solid-while-moving then
  blink, IME-composition aware, background-tab fallback). Enabled on desktop, web **and** mobile; a
  *Smooth caret* toggle lives in Settings (desktop + mobile) and the ⌘K palette.
- `Editor.tsx` rewritten: keyed per document (own undo history/decorations), static CSS moved to
  `index.css`, no per-keystroke re-render, echo-aware content sync, readable centred page (`.mn-page`,
  78ch), click-below-text places the caret at the end, better placeholders, desktop settings extracted
  to `SettingsPanel.tsx`.
- Empty state when no document is open (typing into a void document was silently discarded before).

### Persistence & data safety
- Flush-save before switching documents/projects, when the app is backgrounded (`visibilitychange`), and
  on desktop window close (`onCloseRequested`).
- Canvases pass their document id with each update and flush pending edits on unmount and before Save;
  a late flush that arrives after a switch is saved directly to the right file.
- Rust: `write_atomic` (tmp + rename) for project.json, registry and documents; `project.json` no longer
  stores document bodies; corrupt/unreadable document files are skipped with a warning instead of making
  the whole project unopenable; new `rename_project` / `delete_project` / `export_file` commands;
  `save_asset` takes a raw binary body (no more JSON `number[]` for image bytes).
- Save failures surface in the status bar instead of only in the console.

### Platform shells
- `lib/platform.ts` — `useShell()` decides mobile vs. desktop by OS/touch, `isNarrow` only collapses the
  desktop panels into drawers. `?shell=mobile|desktop` forces a shell on the web build for testing.
- Welcome screen: *Open Folder* (registers an existing project folder), per-project *remove from list*,
  document counts. Project modal now honours the *Default save folder* setting (it was ignored).

### Fantasy map studio
- Touch: single-finger strokes start on `touchstart` (brushes, regions, routes now work on phones); a
  second finger cancels into pinch-zoom; larger transform handles on touch.
- Rendering: hillshade relief in the classic style; slope-aware relief and grainy sea wash in the ink
  style; coastline chained + Chaikin-smoothed into flowing polylines with a soft wash under a crisp ink
  line; region/place labels measured for true centring, haloed in paper colour, realm names set in
  letter-spaced caps; roads get a paper casing in ink style; double-ruled cartouche; grid drawn as one
  shape; decoded-image cache for the hundreds of scattered icons.
- Export: native *Save as…* on desktop, `exports/` folder on Android, download in the browser; rendered
  off-screen (no view flash).
- UX: tool hotkeys (V/H/L/S/P/B/R/D/T, Ctrl+0/+/−), Ctrl+C/V for icons, Esc closes everything, phone
  panels are dismissable overlays, toolbar scrolls horizontally on phones, generate panel fits phones.
- Lint-clean (refs mirrored into state where the render needs them, effects ordered correctly).

### Housekeeping
- ESLint ignores vendored `public/`; **0 lint errors** now. Sidebar icons follow `docType` (a mind map
  called "Ideas" no longer shows as a note). Jargon sweep in the project modal.

## 3. Roadmap (not done in this pass)

### AI assistant (in progress on `feature/ai-assistant`)
| Phase | Scope | Status |
|---|---|---|
| 0 | Feasibility spike: CLI lockdown, modes, cross-model handoff, usage data ([AI_PHASE0.md](./AI_PHASE0.md)) | ✅ done |
| 1 | Backend engine (Claude Code bridge + Anthropic/OpenAI/Gemini API keys), per-project sessions, key storage, `lib/ai/` | ✅ done (no UI) |
| 2 | Chat UI: desktop side panel + mobile AI tab, session list with model icons, model picker | ✅ done |
| 3 | Write tools (text / mind map / map edits), Ask approval cards, Auto with snapshots + undo | ✅ done |
| 4 | Inline commands (`/polish`, `/proofread`, `/grammar`, `/shorten`, `/expand`, `/tone`, continue) | ✅ done |
| 5 | Settings → AI: account, plan, usage bars, API keys, default mode | ✅ done |
| 6a | Phone ↔ PC pairing (phone uses the PC's Claude Code) | ✅ done (device test pending) |
| 6b | Gemini CLI bridge (Codex not installed; Antigravity has no headless CLI), OpenAI partner sign-in | later |

**Future AI connections (noted 2026-11-12, after v2.1.0):**
- **Gemini CLI** — uses the writer's Google AI Pro subscription (Google One) the allowed way: Google's
  own CLI signs in ("Login with Google"), MnemoScript drives it like Claude Code (locked down, MCP
  tools only). Needs Gemini CLI installed to build and test against the real tool. Antigravity is an
  IDE with no headless CLI, so it can't be used.
- **OpenCode** (already installed on the dev PC via winget) — open-source agent CLI with a headless
  mode (`opencode run`), machine-readable output and MCP support; gives access to free models
  (OpenCode's free selection, OpenRouter free models) and the writer's own API keys. Caveats to show
  in the UI: some free models may log or train on prompts (manuscript privacy), rate limits, varying
  quality. Never use OpenCode's Claude-subscription sign-in plug-ins (forbidden by Anthropic).
- **Ollama** — local open models on the PC: free and fully private; with phone pairing the phone
  could use it too (pairing currently allows Claude Code turns only).
- **Codex CLI** — ✅ done (ChatGPT (your subscription)); phone pairing still relays Claude Code only.
- OpenCode finding (2026-11-12): free models reported "Free usage limit reached" for this account and
  `opencode run` retried instead of exiting — the bridge needs a stall timeout; test after the limit resets
  or with the writer's own provider key (DeepSeek is configured in OpenCode).

### P1 — next sprint
- **Grammar without the network.** `grammar-service.ts` posts every document to api.languagetool.org
  (privacy + offline). Options: bundle LanguageTool locally (desktop only, JVM), or switch to a WASM
  spell-checker (e.g. Hunspell via WASM) with LanguageTool as an opt-in.
- **PDF export on Android.** `window.print()` from a hidden iframe is unreliable in the Android WebView.
  Render the book HTML to PDF in Rust (e.g. `printpdf`/`typst`) or via a JS PDF lib, and share/save through
  the dialog plugin.
- **Project rename in the UI** (backend command exists now), plus delete-with-files behind a confirm.
- **Bundle size.** Main chunk ≈ 975 kB (React Flow + TipTap + speech glue). Lazy-load `MindMap` like the
  map studio, and split the dictation worker chain further.
- **APK size — the biggest single win.** The signed universal release APK is ~237 MB, and almost all of
  it is offline-speech assets copied into `app/public/` by `npm run setup:speech`:
  `public/ort/` ships **every** onnxruntime-web variant (asyncify 23 MB + jsep 26 MB + jspi 15 MB +
  plain 13 MB) although the app only runs ORT single-threaded for `vad-web`, plus the ~42 MB Whisper
  model. Copying just the one wasm variant that is actually loaded should cut the APK (and the Windows
  installer) by well over 100 MB. Needs care: the wasm file is picked at runtime by the browser's
  feature detection, so verify dictation still starts on Android and WebView2 after trimming.
  A per-ABI APK (`--target aarch64`) is the interim answer for sideloading.

### P2 — quality of life
- Focus/typewriter mode (dim everything but the current paragraph; keep the caret vertically centred).
- Writing goals & session stats (words today, streaks) in the status bar.
- Explorer: reorder documents by drag (order field exists but isn't user-editable), keyboard navigation.
- Editor: find & replace, footnotes, comments/annotations, word-level history (TipTap `History` depth).
- Mind map: node notes/attachments, link nodes to documents, export PNG (needs the same off-screen
  render approach as the map).
- Map studio: region fill patterns, river auto-tracing downhill from the heightmap, label curvature along
  paths, battlemap kind with VTT export (registry is ready for it).

### P3 — platform
- Cloud/optional sync (the on-disk layout is already one-folder-per-project; a file-sync provider works
  without changes, but conflict handling needs `updated_at` reconciliation).
- iOS build (Tauri mobile supports it; needs the same `gen/` manifest care as Android for microphone).
- Tests: **done** (see [TESTING.md](./TESTING.md)) — 65 Vitest unit + regression tests and 11 `cargo test`
  cases run in CI. Next: Playwright end-to-end runs against the web build, and on-device smoke automation.

## 4. How to verify a build
```bash
cd app
npm run lint          # 0 errors expected
npx tsc -b            # type check
npm run build         # vite production build
cd src-tauri && cargo check
```
Web preview for UI work: `npm run dev` then open `http://localhost:1420/` (add `?shell=mobile` to see
the phone shell in a desktop browser).
