# MnemoScript Architecture

A quick map of how the app is put together, so changes don't require re-reading everything.
For the chronological change history see [DEVLOG.md](./DEVLOG.md).

## Stack
- **Shell:** Tauri 2 (Rust backend + system WebView).
- **Frontend:** React 19 + TypeScript + Vite 8, Tailwind CSS v4.
- **Editor:** TipTap 3 (ProseMirror). **Mind map:** React Flow (`@xyflow/react` 12).
- **Icons:** lucide-react. **Grammar:** LanguageTool API (`grammar-service.ts`).

## Data model (`src/types.ts` ↔ `src-tauri/src/project.rs`)
```
Project  { id, name, description?, author?, created_at, path?, documents[], folders[] }
Folder   { id, name, order, parentId? }              # parentId null ⇒ project root
Document { id, title, content, updated_at, docType: 'text'|'mindmap', order, folderId? }
```
- `text` doc → `content` is rich-text **HTML** (TipTap).
- `mindmap` doc → `content` is **JSON** `{ nodes, edges }` (React Flow).
- **Directories:** `folders[]` is a nestable tree (any depth via `parentId`). A document's
  `folderId` is the directory it lives in (`null`/absent ⇒ root). Folders persist in
  `project.json` (saved via `save_project`); `folderId` persists on each `documents/<id>.json`
  (saved via `save_document`). Move = update `folderId`/`parentId` + re-save. Deleting a folder
  lifts its children to the parent (no documents are deleted). The explorer supports both
  drag-and-drop and a right-click "Move to" menu.
- New Rust fields use `#[serde(default)]` so older `project.json` files still load.

## Where data lives on disk
A project is a folder (custom path, or `~/.mnemoscript/projects/<id>` by default):
```
<project>/
  project.json            # metadata (+ a documents snapshot)
  documents/<id>.json     # one file per document (source of truth on open)
  assets/<uuid>.<ext>     # imported images
```
A global registry at `~/.mnemoscript/registry.json` maps project id → folder path.
`list_projects` reads metadata only; **opening a project uses `load_project`**, which reads the
`documents/` folder (so newly added docs show up).

## Backend commands (`src-tauri/src/lib.rs`)
All return an `ApiResponse<T>` = `{ success, data, error }` envelope.
`create_project` · `save_project` · `rename_project` · `delete_project` (registry only, or with files) ·
`load_project` · `list_projects` · `open_project_by_path` · `create_document` (takes `docType`/`order`) ·
`save_document` · `load_document` · `delete_document` · **`save_asset`** (raw binary body + `x-project-id`
/ `x-ext` headers → copies into `assets/`, returns the absolute path) · **`export_file`** (raw body →
`<project>/exports/<name>`) · `select_directory`.
All file writes go through `write_atomic` (tmp + rename). `project.json` stores folders + a
**content-free** document index; document bodies live only in `documents/<id>.json`. Unreadable or
corrupt document files are skipped with a warning so one bad file never blocks a project.

## Frontend layering
- **`src/lib/api.ts`** — the *only* place that calls `invoke`; typed, unwraps `ApiResponse`, throws
  on failure. Always go through this.
- **`src/lib/assets.ts`** — `toAssetUrl(path)` and `resolveImagesInHtml(html)`. Image `src` is
  stored as a raw disk path and resolved to a Tauri asset URL (`convertFileSrc`) only at render
  time. Asset protocol is enabled in `tauri.conf.json` (`app.security.assetProtocol`) +
  `Cargo.toml` (`protocol-asset` feature).
- **`src/lib/platform.ts`** — `isTauri`, `isMobileOS`, and `useShell()` → `{ isMobileShell, isNarrow,
  isTouch }`. The shell is chosen by *platform* (phone OS, or a narrow touch viewport on the web), never
  by window width alone; `isNarrow` only collapses the desktop panels into drawers. `?shell=mobile` /
  `?shell=desktop` forces a shell on the web build for testing.
- **`App.tsx`** — owns all app state, persistence and the data handlers; branches on `isMobileShell`:
  `<MobileShell>` on phones, else the desktop layout. Both shells get the same handlers. localStorage
  holds only UI prefs (`usePref`). **Data safety:** `flushIfDirty()` saves the open document before a
  document/project switch, on `visibilitychange` (app backgrounded) and on the desktop window's
  `onCloseRequested`. `handleUpdateDocumentContent(content, docId?)` — canvases pass their `docId`, so a
  late flush that arrives after a switch is written straight to the right file.

## Responsive shells (desktop vs. mobile are different UIs)
The desktop and Android UIs are intentionally **separate** (a phone is not a shrunken desktop):
- **Desktop** = `DesktopTopBar` (slim app bar; the old VS Code menubar is gone) + a **⌘K
  `CommandPalette`** (most actions live here) + the docked `Sidebar` (explorer) and summonable
  `RightSidebar` ("Format", **closed by default**) + a slim status bar. Editor-first, more whitespace.
- **Mobile** (`src/components/mobile/`) = `MobileShell` with a **bottom tab bar** (Library / Write /
  Tools / Settings), a slim `MobileTopBar` on the Write screen, `MobileLibrary` (a clean grouped
  document list + new-doc `BottomSheet`, replacing the explorer tree), the reused `Editor` in
  **`chrome="mobile"`** mode (no desktop toolbar, native caret), a `ToolsSheet` `BottomSheet`
  (format/read-aloud/dictation), and a full-screen `MobileSettings` (theme swatches + typography).
- **Shared controls** (`src/components/controls/`): `FormatControls`, `ReadAloudControls`,
  `DictationControls` (size `'sm'`|`'lg'`) are used by *both* `RightSidebar` and `ToolsSheet` — wrap
  the existing `useReadAloud`/`useDictation` hooks + `editor.chain()` commands. Don't duplicate them.
- **Touch:** `index.html` viewport is `user-scalable=no, maximum-scale=1` (no accidental page zoom);
  `index.css` adds `touch-action: manipulation` + the `.mn-*` primitives (sheet, tabbar, fab, rows).
  `FantasyMap` has two-finger pinch-zoom/pan (Konva `onTouch*`); React Flow (`MindMap`) pinches by
  default once the page-zoom hijack is removed.

## Editor (`src/components/Editor.tsx`)
Mounted **keyed by document id** (own undo history / decorations per document). Nothing re-renders on a
keystroke: the parent gets HTML via `onUpdate`, and the sync effect ignores the echo of our own edits
(`lastEmittedRef`). Static styling lives in `index.css` (`.mn-editor-scroll`, `.mn-page` — a centred
78ch measure — and the `.ProseMirror…` rules); only the user's typography choices are inline. The
desktop settings screen is `SettingsPanel.tsx` (App renders it; the editor no longer has a settings branch).

**Smooth caret (`SmoothCaret.tsx`)** — the Word-style gliding caret, on desktop, web and mobile. A
ref-driven overlay inside the scroll container (content-space coords via `view.coordsAtPos` + scroll
offset), moved with a GPU `transform` in one rAF per change (timer fallback while the tab is hidden),
solid while moving and blinking only after ~450 ms at rest, hidden for non-empty selections/blur and
during IME composition (`.is-composing` restores the native caret). The native caret is hidden with
`.mn-smooth-caret .ProseMirror { caret-color: transparent }`. User toggle: `smoothCaret` pref.

## Editor extensions
`StarterKit` (+ heading/list keymaps) · `Placeholder` · `TextAlign` · **`TaskList`/`TaskItem`**
(`/todo` checkbox lists, nestable) · `LinguisticCheck` (grammar) · **`ReadAloudHighlight`**
(karaoke highlight for TTS) · **`ImageWithAsset`** (asset-rendering image node) · **`SlashCommand`**
(the `/` menu).
The slash menu (`SlashCommand.ts` + `SlashMenu.tsx` + `slashItems.ts`) is built on
`@tiptap/suggestion`; its React popup is positioned at the caret via the suggestion `clientRect`
(same manual technique as the grammar popover — no tippy.js).

**To-do lists** are a Notes-only feature: the `Editor` + `RightSidebar` ("To-do List" button)
render only for `docType==='text'`, so task lists never appear in mind maps or fantasy maps.
Type `/todo` (or click the sidebar button) to insert a checkbox list; checked items strike
through. They serialise to HTML in `Document.content` like every other block — no extra
persistence. Checkbox styling lives in the `.ProseMirror ul[data-type="taskList"]` rules.

## Speech: Read-Aloud (TTS) + Voice-to-Text (dictation)
Both live under `src/lib/speech/` and are **Notes/Chapters/Scenes-only** (the `Editor` +
`RightSidebar` mount only for `docType==='text'`). Toolbar buttons live in `Editor.tsx`; full
controls live in `RightSidebar.tsx`.

- **Read-Aloud (TTS)** — `ttsController.ts` wraps the WebView's `speechSynthesis` (no deps).
  It splits the active text (current selection, else whole doc) into sentences (`Intl.Segmenter`),
  speaks them one at a time, and drives a karaoke highlight via the `ReadAloudHighlight` decoration
  extension (`components/extensions/ReadAloudHighlight.ts`): `.tts-sentence` always, `.tts-word`
  where the engine emits boundary events; the active node auto-scrolls. Sentence/word positions
  come from the shared `lib/proseFlatText.ts` (`buildFlatText`, also used by grammar highlighting).
  Hook: `useReadAloud(editor)`. Highlight CSS is in the `Editor.tsx` `<style>` block.

- **Voice-to-Text (offline)** — two-stage pipeline under `lib/speech/dictation/`:
  `mic → [① browser denoise] → [② Silero VAD gate] → [Whisper worker] → caret`. The VAD
  (`@ricky0123/vad-web`, "gatekeeper" model) drops silence/gaps/dud sound and emits only speech
  segments; each is transcribed by Whisper (`@huggingface/transformers`, `whisper-tiny.en`, q8) in
  a Web Worker (`transcriber.worker.ts`). `dictationController.ts` orchestrates; `useDictation`
  inserts each segment at the caret. Heavy libs are **dynamically imported** (kept out of the main
  bundle). **Offline setup (two scripts; outputs gitignored):** `npm run setup:speech`
  (`scripts/setup_speech_assets.mjs`) copies the VAD worklet + Silero ONNX to `public/vad/` and
  onnxruntime-web wasm to `public/ort/`; `npm run fetch:model` (`scripts/fetch_whisper_model.mjs`)
  downloads the Whisper **q8 / `_quantized`** files (~42 MB) to
  `public/models/onnx-community/whisper-tiny.en/`. The worker loads the model **locally**
  (`allowRemoteModels=false`, `localModelPath='/models/'`) so dictation is fully offline with no
  first-run download. ORT runs single-threaded (no COOP/COEP). **Version trap:** `vad-web` + the
  `/ort/` copy are both onnxruntime-web 1.27, but transformers.js bundles its *own* ORT (1.26-dev)
  and uses its Vite-emitted wasm — never point its `wasmPaths` at `/ort/` (ABI mismatch hangs model
  init). Android needs `RECORD_AUDIO` in the (regenerated) `gen/android` manifest. Mic capture
  depends on the WebView granting the permission (WebView2 `PermissionRequested` / Android runtime)
  — verify on-device.

## Feature components
- **`MindMap.tsx`** — React Flow canvas; serializes `{nodes,edges}` to `content` (debounced 400 ms,
  flushed on unmount and before Save; updates carry the `docId`).
- **`FantasyMap.tsx`** (+ `fantasymap/`) — Konva map studio; see [FANTASYMAP.md](./FANTASYMAP.md). Touch:
  one finger = mouse (handled on `touchstart`, not `tap`), two fingers = pinch/pan. Export renders the
  page off-screen at the current zoom and saves via Save-as (desktop) / `export_file` (Android) /
  download (browser). `heightmap.ts` adds hillshade relief (classic), slope-aware relief (ink) and
  `coastPolylines()` (chained + Chaikin-smoothed marching-squares contour).
- **`BookCompiler.tsx`** — File → "Compile to PDF Book": builds a print-CSS book HTML in a hidden
  iframe and calls `print()` → "Save as PDF". Text chapters only (mind maps excluded for now).

## Styling
Theme tokens (6 themes) live in `src/index.css` (`body.theme-*` CSS variables + Tailwind v4
`@theme`). Feature CSS (`.mindmap-*`, `.slash-menu`, `.editor-image`) is appended there.
Note: `src/App.css` is **legacy and not imported** — don't edit it; use `index.css`.

## Validate before committing
`cd app && npm run lint && npx tsc -b && npm run build` · `cd app/src-tauri && cargo check`.
Lint must be at **0 errors** (React Compiler rules: never read `ref.current` during render — mirror
into state; never call setState synchronously in an effect body).
