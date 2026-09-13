# MnemoScript Development Log

A running log of substantive changes, so future work needs less re-discovery.
Newest entries first. Dates are absolute.

---

## 2026-09-13 — v2.0.0 packaging: Windows setup installer + signed Android APK

Shippable builds for both platforms, verified by installing and launching them.

- **Windows installer.** `tauri.conf.json` gained installer metadata (publisher, short/long
  description, copyright, category) and a `bundle.windows` block: **NSIS per-user install mode** (no
  UAC prompt), English-only, and a silent WebView2 `downloadBootstrapper`. Default window is now
  1280×820 (min 760×520), centred. Output:
  - `bundle/nsis/MnemoScript_2.0.0_x64-setup.exe` — wizard; installs to `%LOCALAPPDATA%\MnemoScript`,
    creates Start-menu **and** desktop shortcuts, registers an uninstaller under *Settings → Apps*.
  - `bundle/msi/MnemoScript_2.0.0_x64_en-US.msi` — for `msiexec` / managed deployment.
  - `target/release/MnemoScript.exe` — portable.
- **Fixed: the installed executable was `app.exe`.** The Cargo package is named `app`, and Tauri names
  the binary after it, so the install folder and Task Manager showed a generic name. Added an explicit
  `[[bin]] name = "MnemoScript"` plus `mainBinaryName` in `tauri.conf.json`. `[lib] name = "app_lib"`
  is deliberately unchanged — `gen/android` links `libapp_lib.so` by that exact name.
- **Android release signing.** Generated `gen/android/keystore.jks` and wired `signingConfigs` into
  `gen/android/app/build.gradle.kts`, reading `keystore.properties`; both files are git-ignored, and
  the gradle block degrades to an unsigned build if they are absent. A debug APK bundles all four ABIs
  with debug symbols (~700 MB); the signed release APK is a fraction of that.
- **Docs**: new [INSTALL.md](./INSTALL.md) (Windows wizard/MSI/portable/silent, SmartScreen, updating,
  uninstalling; Android sideloading and the "back up your keystore" warning), README install sections,
  `ANDROID.md` signing note. Artifacts are collected into the git-ignored `release/` folder.
- **Verified on this machine**: ran the setup silently, confirmed the install folder, Start-menu and
  desktop shortcuts and the *Add/Remove Programs* entry (publisher "ehitimum", version 2.0.0), launched
  the app (window title "MnemoScript", WebView2 renderers up), and confirmed the backend created
  `~/.mnemoscript/registry.json`.

---


## 2026-09-11 — v2.0.0: test suites, CI, concurrency fix, release metadata

- **Tests** (new; see [TESTING.md](./TESTING.md)): Vitest + jsdom + Testing Library — 47 unit tests
  (`platform`, `proseFlatText`, `heightmap`, `mapTypes`, `generator`, browser `api`) and 18 regression
  tests that mount the real Sidebar / Editor / MindMap / App (shell selection, flush-on-switch, late
  canvas flush routing, smooth-caret overlay, edit-echo). `cargo test`: 11 cases for `project.rs` /
  `lib.rs`. `npm run check` runs lint → types → tests → build.
- **Concurrency bug found by the tests**: `write_atomic` used one shared `*.tmp` name, so two
  concurrent writers of the same file (e.g. `registry.json` from parallel saves) renamed each other's
  temp file away. Temp names are now unique and registry mutations are serialised with a mutex.
- **CI**: `.github/workflows/ci.yml` (lint, typecheck, tests, build, cargo test, clippy) on every push.
- **Release metadata**: version 2.0.0 in `package.json`, `tauri.conf.json`, `Cargo.toml`; window/tab
  title "MnemoScript"; README rewritten; `AGENTS.md` lists the gates.

---

## 2026-09-11 — Smooth caret back on every platform, data-safety pass, map studio refinement

Full codebase audit; findings + roadmap in [IMPROVEMENT_PLAN.md](./IMPROVEMENT_PLAN.md).

- **Word-style typing (restored, all platforms).** New `components/SmoothCaret.tsx`: a ref-driven caret
  overlay (no React state, one rAF per change, GPU `transform`, content-space coords, blink only after
  the caret rests, IME-aware, background-tab fallback). The old implementation re-rendered the editor on
  every keystroke and had been disabled on mobile. Toggle in Settings + ⌘K.
- **Editor.tsx rewrite** — keyed per document (own undo/decorations), static CSS moved to `index.css`,
  echo-aware content sync (no double `getHTML()` per keystroke), readable `.mn-page` column, settings
  extracted to `SettingsPanel.tsx`, empty state when no document is open.
- **Data safety** — flush-save on document/project switch, app background, desktop window close; canvases
  flush pending debounced edits on unmount/Save and tag updates with their `docId`; Rust atomic writes,
  content-free `project.json`, tolerant document loading; save errors shown in the status bar.
- **Shell by platform** (`lib/platform.ts`): phone shell only on phones; narrow desktop windows keep the
  desktop shell with drawers. `?shell=mobile` forces the phone shell on the web build.
- **Backend** — `rename_project`, `delete_project`, `export_file`; `save_asset` takes a raw binary body.
  Capabilities: window close/destroy, dialog save, fs write.
- **Fantasy map** — touch strokes fixed (touchstart, not tap), safe PNG export (Save-as / exports folder),
  hillshade + slope relief, smoothed inked coastline, measured + haloed labels, single-shape grid, image
  cache, hotkeys, phone panel overlays, lint-clean refs.
- **Lint**: 50 → 0 errors (`public/` ignored; React-Compiler ref/effect rules fixed in MindMap,
  FantasyMap, useImage, useMapHistory, App).
- **Verified**: `tsc -b` ✓ · `eslint` ✓ (0) · `vite build` ✓ · `cargo check` ✓ · browser check of the
  web build: project creation, chapter creation, typing, caret position == `coordsAtPos`, hidden on
  selection/blur, blink after pause, flush-on-switch persisted, phone shell via `?shell=mobile`.
  **Needs device testing**: Android touch painting, Save-as dialog on Windows, window-close flush.

---

## 2026-06-25 — UI redesign: separate mobile app shell + bolder desktop reshape

The single VS Code-style shell felt cramped/misaligned on phones and IDE-like for non-technical
writers. Goal: **simple UX, elegant UI** (the user clarified "simple" = experience, not plain visuals).

- **`App.tsx` now branches on `isMobile`** → `<MobileShell>` vs. the desktop layout. All state +
  handlers stay in App; both shells receive them.
- **Mobile (new, `src/components/mobile/`)** — a phone-native shell: bottom **tab bar**
  (Library / Write / Tools / Settings), `MobileTopBar`, `MobileLibrary` (grouped doc list + new-doc
  `BottomSheet`, replaces the explorer tree), the reused `Editor` in **`chrome="mobile"`** (no
  desktop toolbar, native caret), a `ToolsSheet` bottom sheet, and `MobileSettings` (theme swatches).
- **Desktop reshape** — replaced the menubar with a slim **`DesktopTopBar`** + a **⌘K
  `CommandPalette`** (New/Save/Compile/Close, toggle panels, themes, settings…). Right "Format" panel
  is **closed by default** (editor-first); ⌘K / Ctrl+S shortcuts. Jargon sweep ("Repository"→"Save
  folder", "Save Target"→"Save", "Workspace mounted"→"No project open", etc.).
- **Shared controls** (`src/components/controls/`): extracted `FormatControls`/`ReadAloudControls`/
  `DictationControls` from `RightSidebar` so the desktop panel and mobile sheet reuse one source.
- **Touch fixes** — viewport `user-scalable=no,maximum-scale=1` (kills accidental page pinch-zoom);
  `touch-action: manipulation`; FantasyMap gets Konva two-finger pinch-zoom/pan; React Flow pinch now
  works. New `.mn-*` CSS primitives (sheet/tabbar/fab/rows/palette).
- **Verified**: `npm run build` ✓; new components lint-clean (remaining lint errors are pre-existing
  React-Compiler warnings in FantasyMap/MindMap/hooks). Visual check via headless-Chrome CDP at
  390 px (mobile, **0 horizontal overflow**) + 1300 px (desktop): welcome, library, settings (theme
  swatches), and the ⌘K palette all render cleanly. **Needs device testing**: data flows that require
  the Tauri backend (create/open project, editor on a phone), and on-device pinch-zoom.

---

## 2026-06-25 — Read-Aloud (TTS) + offline Voice-to-Text (dictation)

Two accessibility/authoring features for text docs (Notes / Chapters / Scenes). Both are
Notes-only for free: `Editor` + `RightSidebar` mount only for `docType==='text'`.

### Read-Aloud (Text-to-Speech) with karaoke highlight
- Uses the WebView's built-in `speechSynthesis` (no deps; works on WebView2 + Android WebView).
- New `app/src/lib/speech/ttsController.ts` splits the active text (selection if any, else the
  whole doc) into sentences with `Intl.Segmenter`, speaks them one at a time, and pushes
  highlight ranges to a new decoration extension `components/extensions/ReadAloudHighlight.ts`
  (`.tts-sentence` always; `.tts-word` where the engine emits boundary events). The active node
  auto-scrolls into view.
- The flat-text↔ProseMirror offset map (`buildFlatText`) was extracted from `LinguisticCheck.ts`
  into a shared `app/src/lib/proseFlatText.ts` (grammar + TTS now share one coordinate system).
- UI: toolbar speaker toggle in `Editor.tsx` + a "Read Aloud" section in `RightSidebar.tsx`
  (play/pause/stop, voice picker, speed). Hook: `lib/speech/useReadAloud.ts`.

### Voice-to-Text (offline, two-stage pipeline)
Pipeline: **mic → [① browser denoise] → [② Silero VAD gate] → [Whisper worker] → caret**.
- **Gatekeeper model** = Silero VAD via `@ricky0123/vad-web` (drops silence/gaps/dud sound, emits
  only real speech segments). **Main model** = Whisper (`onnx-community/whisper-tiny.en`, q8) via
  `@huggingface/transformers`, run in a Web Worker (`dictation/transcriber.worker.ts`).
- Modules under `app/src/lib/speech/dictation/`: `audioCapture.ts` (getUserMedia + denoise
  constraints), `transcriber.ts` (worker handle), `dictationController.ts` (orchestration), plus
  `useDictation.ts` (inserts segments at the caret). Heavy libs are dynamically imported so they
  stay out of the main bundle (worker chunk ≈ 0.7 MB; ORT wasm code-split).
- **Offline assets (two scripts; outputs gitignored)**: `npm run setup:speech`
  (`scripts/setup_speech_assets.mjs`) copies the VAD worklet + Silero ONNX → `app/public/vad/` and
  onnxruntime-web wasm → `app/public/ort/`; `npm run fetch:model`
  (`scripts/fetch_whisper_model.mjs`) downloads the Whisper q8 (`_quantized`) files (~42 MB) →
  `app/public/models/onnx-community/whisper-tiny.en/`. The worker loads the model **locally**
  (`allowRemoteModels=false`) in single-threaded ORT mode — dictation is fully offline, no first-run
  download.
- **Debug pass (same day)** after on-device testing showed the model never loading:
  - **App "loading forever"** — the worker forced transformers.js' bundled ORT (1.26-dev) to use our
    `/ort/` wasm (1.27) → ABI mismatch that hangs init. Fixed: transformers uses its own wasm;
    `/ort/` is for `vad-web` only (also 1.27, matched).
  - **`load()` hung instead of erroring** — a load-phase worker error (no request id) was only
    `console.error`'d. Fixed: it now rejects `load()` (+ a `worker.onerror` guard), so failures show
    a message instead of an infinite spinner. Errors are split into model-load vs mic/VAD stages and
    logged with a `[dictation]` prefix.
  - **Web "refuse"** — an `optimizeDeps.exclude` of `onnxruntime-web`/`vad-web` broke dev-mode
    resolution of the dynamic import. Fixed: switched to `optimizeDeps.include`.
  - **Remote model fetch failed inside the WebView** → bundled the model locally (above) instead.
- **Android**: added `RECORD_AUDIO` (+ optional microphone feature) to
  `gen/android/app/src/main/AndroidManifest.xml`. ⚠ `gen/android` is regenerated by
  `tauri android init` — re-add if lost.
- UI: the previously-placeholder toolbar mic in `Editor.tsx` now toggles real dictation (loading /
  listening / speaking states) + a "Dictation" section in `RightSidebar.tsx` (start/stop, noise
  cleanup toggle, model-load progress, errors).
- Vite: `optimizeDeps.exclude` the three speech libs (lazily loaded).
- **Verified**: `npm run build` ✓ (tsc + vite), new files lint-clean, offline assets present in
  `dist/vad` + `dist/ort`. **Needs device testing**: actual mic capture / WebView permission grant
  (WebView2 `PermissionRequested`; Android runtime RECORD_AUDIO) and first-run model download.

---

## 2026-06-15 — Frontend theming + editor typography fixes

Bug-fix + polish pass on the frontend (`app/src/index.css` plus copy tweaks).

- **Themes were not switching (root cause).** `index.css` used `@theme { --color-x: var(--token) }`
  (non-inline). Tailwind v4 resolves those at `:root` and bakes the default (dark) values into the
  utilities, so overriding the tokens on `body.theme-*` never reached `bg-*`/`text-*`. **Fix:** switched
  to **`@theme inline`** — utilities now compile to the raw `var(--background)` etc. that the body class
  overrides. Verified: prod CSS shows `.bg-background{background-color:var(--background)}` (no
  `var(--color-background)` left), and live Midnight→Parchment switching works.
- **Refreshed all 6 color schemes** to cohesive "dark base + single accent" palettes (Midnight/slate,
  Parchment/paper, Nebula/violet, Ocean/blue, Forest/emerald, Sunset/coral). Renamed theme + font
  labels to writer-friendly names (dropped "Technical"/"Engine" wording).
- **Heading buttons didn't change size + ghost title wasn't H2.** There were no `.ProseMirror h1/h2/h3`
  rules, and Tailwind preflight resets headings to inherit. **Fix:** added em-based heading typography
  (h1 2em / h2 1.5em / h3 1.25em) in `index.css`. Verified rendered sizes 32/24/20 px at a 16px base.
  The default chapter title node is an empty `<h2>`, so its placeholder ("Title…") now shows at H2 size.
- **Other fixes:** defined `--color-destructive`/`-foreground` (the `text-destructive`/`bg-destructive`
  utilities were silently no-ops, so error text/box now renders red); defined the grammar-underline
  tokens `--color-typo`/`--color-grammar` (previously only in the unused `App.css`, so underlines were
  colorless); added elegant theme-aware scrollbars and code-block/inline-code/`<hr>` styling.
- Added `.claude/launch.json` (`mnemoscript-web`) so the web frontend can be previewed without Tauri.
- Verified: `npm run build` ✓ and live preview screenshots (Midnight + Parchment).

---

## 2026-06-15 — Writer feature build (mind map, slash menu, image embed, PDF book) + backend persistence

Large feature pass turning the prototype into a real authoring tool. Four user-facing
features, built on a persistence rewrite.

### Foundation: real disk persistence (was localStorage)
**Why:** the Rust backend (`src-tauri/src/project.rs`, `lib.rs`) already implemented full
disk persistence but the frontend never called it — `App.tsx` stored projects in
`localStorage` (~5 MB cap) and `ProjectCreationModal` created a *mock* project. Auto-save and
manual save persisted nothing. localStorage cannot hold images or large books.

**Changes:**
- `src-tauri/src/project.rs`
  - `Document` gained `doc_type` (`"text"` | `"mindmap"`, serde-renamed to `docType`, default
    `"text"`) and `order: i32` (default 0). Both `#[serde(default)]` → old `project.json` files
    still load.
  - `Project` gained `author: Option<String>` (`#[serde(default)]`) for the book cover.
  - `Document::new(title, content, doc_type, order)` signature extended.
  - Added `Project::resolve_dir(project_id)` helper (deduped the project-dir logic that was
    copy-pasted in `Document::save`/`load`); documents now sort by `order` then `updated_at`.
- `src-tauri/src/lib.rs`
  - `create_document` command now takes optional `doc_type` / `order`.
  - New command **`import_image(project_id)`**: native image picker (rfd) → copies the file into
    `<project>/assets/<uuid>.<ext>` → returns the absolute path. Registered in the handler list.
- `src-tauri/tauri.conf.json`: enabled the **asset protocol** (`app.security.assetProtocol`,
  scope `$HOME/**`, `$APPDATA/**`, `$DOCUMENT/**`) so on-disk images render via `convertFileSrc`.
- Frontend:
  - New **`src/lib/api.ts`** — typed wrapper over every Tauri command, unwraps the
    `ApiResponse<T>` envelope and throws on failure.
  - New **`src/lib/assets.ts`** — `toAssetUrl(path)` (raw path → asset URL) and
    `resolveImagesInHtml(html)`; used by the image node and the book compiler.
  - `types.ts`: `Document` now has `docType` + `order`; `Project` has `author`.
  - `App.tsx`: loads projects via `api.listProjects()` on startup; opening a project calls
    `api.loadProject` (reads the documents/ folder); document creation calls `api.createDocument`.
    Real **auto-save** (interval, persists when dirty) + **manual save** via `api.saveDocument`,
    using refs to avoid stale closures. localStorage now only holds UI prefs (theme, fonts, etc.).
  - `ProjectCreationModal.tsx`: creates the project on disk via `api.createProject` (+ error state).
  - `Sidebar.tsx`: `onCreateDocument(title, docType)`; "New MindMap" creates a `mindmap` doc.
  - `Editor.tsx`: removed the dead save props (`manualSaveRequested`/`onSaveSuccess`/…); persistence
    lives in `App` now.

### 1. Slash "/" command menu  (`src/components/extensions/SlashCommand.ts`, `SlashMenu.tsx`, `extensions/slashItems.ts`)
- Built on `@tiptap/suggestion`. Trigger `/`, filter by title/keywords.
- Items: Text, H1–H3, Bulleted/Numbered list, Quote, Code block, Divider, Image.
- Menu is a React component (`SlashMenu`) mounted via `ReactRenderer`, positioned at the caret
  using the suggestion `clientRect` (same manual-positioning approach as the existing grammar
  popover / smooth caret — no tippy.js dependency). Keyboard nav (↑/↓/Enter/Esc).

### 2. Image embedding  (`src/components/extensions/ImageWithAsset.ts`)
- Custom node extending `@tiptap/extension-image`. Stores the **raw on-disk path** in `src`
  (portable in saved content) and renders via a node view that resolves the path with
  `toAssetUrl` (Tauri asset protocol).
- `/image` → `api.importImage(projectId)` → inserts the image. CSS: `.editor-image` in `index.css`.

### 3. Mind map  (`src/components/MindMap.tsx`)
- `@xyflow/react` (React Flow 12). Custom editable node (double-click to rename, 6-color palette
  applied to selected nodes), drag, connect via handles, Del to remove, pan/zoom, MiniMap +
  Controls. Graph persists as JSON `{nodes,edges}` in the document `content` (debounced) + Save
  button. Node CSS lives in `index.css` (`.mindmap-*`).
- `App.tsx` routes `docType === 'mindmap'` docs to `<MindMap>` instead of `<Editor>`; the right
  formatting sidebar + word-count are hidden for canvases.

### 4. Compile to PDF book  (`src/components/BookCompiler.tsx`)
- Modal (File → "Compile to PDF Book"): book title / author / subtitle, cover + TOC toggles, a
  reorderable include-list of **text** chapters.
- Builds a self-contained book HTML (cover → TOC → chapters with `page-break-before`) into a hidden
  iframe with print CSS (`@page` A4, serif), then `iframe.print()` → user picks "Save as PDF".
  Image `src` paths are resolved with `resolveImagesInHtml`.

### Dependencies added (`app/`)
`@xyflow/react@12`, `@tiptap/extension-image@3.22.4`, `@tiptap/suggestion@3.22.4`
(pinned to 3.22.4 to match the repo's exact-peer `@tiptap/core@3.22.4`; installed with
`--legacy-peer-deps` because `@tiptap/extension-placeholder@3.26` muddies peer resolution — a
single `@tiptap/core` copy is confirmed in node_modules).

### Verification
- `cargo check` ✓ · `tsc -b` ✓ · `npm run lint` ✓ · `npm run build` ✓.

### Known limitations / follow-ups
- PDF TOC lists chapter titles without page numbers (a `window.print` constraint).
- Mind maps are excluded from the PDF (would need offscreen React Flow → image snapshot).
- Asset-protocol scope is broad (`$HOME/**` etc.) since projects can live anywhere under home;
  fallback plan if it ever misbehaves is to return base64 from `import_image`.
- Old localStorage projects from before this change are not migrated (prototype data).
