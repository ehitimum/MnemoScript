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
  ai/sessions/<id>.json   # AI chat sessions (per project — see "AI assistant")
```
A global registry at `~/.mnemoscript/registry.json` maps project id → folder path.
**Debug builds use `~/.mnemoscript-dev`** (Android: `<app data>/dev`), so `tauri dev` never reads or
rewrites the installed app's projects.
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

## AI assistant (`src-tauri/src/ai/`, `src/lib/ai/`, `src/components/ai/`)
Feasibility and the reasoning behind the design: [AI_PHASE0.md](./AI_PHASE0.md).
- **Providers.** `claude-code` = the writer's own installed Claude Code CLI and its own sign-in
  (the only legitimate subscription route; MnemoScript never handles a Claude login). `anthropic`,
  `openai`, `gemini` = API keys, usable on desktop and Android. One provider per project
  (`Project.ai` → `ProjectAiConfig`); the **model is switchable per message** inside a provider
  (Claude Code aliases `opus`/`sonnet`/`haiku`/`fable` resolve against the writer's plan). Catalogue:
  `lib/ai/providers.ts`.
- **Turn flow.** `lib/ai/client.ts#runTurn` builds a provider-neutral request from the session
  (`context.ts`: system prompt + mode rules + replayed transcript, tool use as text summaries,
  a note when earlier replies came from other models) → `ai_start_turn` with a Tauri `Channel` →
  `engine.rs` runs the provider and streams `AiEvent`s (`started`, `textDelta`, `toolCall`, `usage`,
  `rateLimit`, `done`, `error`).
- **Tools run in the frontend for every provider.** A `toolCall` event is executed by
  `lib/ai/tools.ts#executeTool` (where the documents live) and answered with `ai_tool_result`.
  API providers run their own tool loop in Rust; Claude Code is started with **no built-in tools**
  (`--tools ""`, empty cwd, clean env, `--setting-sources ""`) and pointed at an in-app MCP endpoint
  (`mcp_http.rs`, `127.0.0.1:<port>/mcp/<per-turn token>`) that forwards `tools/call` to the same path.
- **Modes** (`plan`/`ask`/`auto`) are enforced in code: plan mode never offers a write tool, and
  `executeTool` refuses any tool the mode doesn't offer. **Ask** sends each write to the chat as a
  proposal and waits for Apply/Reject (`ProjectAccess.requestApproval`; Claude Code gets
  `MCP_TOOL_TIMEOUT` = 24 h so the wait can't time out); **Auto** applies at once and keeps the old
  content for undo.
- **Storage.** Sessions: `ai/sessions/<id>.json` in the project folder (`sessions.rs`; the schema
  is `AiSession` in `lib/ai/types.ts`). API keys: OS secret store on desktop (`keyring`), app-private
  file on Android (`secrets.rs`); the frontend can set/clear/check a key but never read it back.
- **Usage data.** Plan limits come from the writer's own Claude Code: `claude -p /usage` is answered
  by the CLI itself (no model call, no cost) with "Current session: 58% used · resets …" lines for the
  5-hour and weekly windows (`claude_code.rs#usage`, command `ai_cli_usage`; refused if an old CLI sent
  it to a model instead). Per-turn `rateLimit` events (window + reset; `utilization` only near a limit)
  still drive the composer's warning. Token counts and cost of every reply and inline command are
  logged on this device (`lib/ai/usage.ts#recordUsage`, localStorage `mnemoscript:ai-usage-log`,
  31 days).
- **UI (Phase 2).** `lib/ai/useAiChat.ts` holds all chat state for one project (sessions, active
  session, view `chat`/`sessions`/`connect`, readiness, streaming batched to one render per frame,
  save-on-send + save-on-finish). `components/ai/AiScope.tsx` mounts it **above** the panel/screen
  (keyed by project id), so closing the panel or switching tabs never kills a running reply and a
  different project always starts clean. Shared pieces (`size: 'sm' | 'lg'`, like `controls/`):
  `AiChatBody` → `AiConnect` / `AiSessions` / `AiMessages` (safe React-element `Markdown`, tool chips,
  error cards with the fix) + `AiComposer` (Plan/Ask/Auto switch, per-message model picker: popover on
  desktop, `BottomSheet` on phones). `ModelBadge`/`ModelStack` = the per-vendor letter marks.
  - **Desktop:** `AiPanel` on the right edge (Format-panel chrome), toggled from the top bar's ✦ AI
    button, ⌘K "Open AI Assistant" or **Ctrl/⌘+L**; Format and AI panels are mutually exclusive; narrow
    windows show it in the right `Drawer`.
  - **Phone:** 5th tab **AI** (Library / Write / AI / Tools / Settings, needs an open project) →
    `MobileAiScreen`: top bar → transcript → composer, all in normal flow (nothing floats over the
    text). While the composer has focus the shell hides the tab bar; `useKeyboardInset` lifts the screen
    when an edge-to-edge WebView doesn't resize for the keyboard. Only API-key providers are offered.
- **Edits (Phase 3).** Write tools: `edit_text` (find → replace on the plain text the model read),
  `write_document`, `create_document` (chapter or mind map), `edit_mind_map`, `edit_fantasy_map`.
  - `lib/ai/textEdits.ts` applies text edits to the HTML in place: matching ignores whitespace runs,
    curly vs straight quotes and the `#`/`-`/`>` markers; a match must be unique; edits in one call are
    all-or-nothing. Inside one paragraph only the changed words are replaced (word diff), so bold/italic
    on kept words survive; across paragraphs it behaves like replacing an editor selection (blank
    paragraphs inside go, list items stay list items). New paragraphs accept light markdown
    (`textToBlocks`, TipTap-compatible HTML incl. task lists).
  - `lib/ai/structEdits.ts`: mind maps (add under a parent with a linked, non-overlapping position,
    `ref` chaining, rename, remove with its links) and fantasy maps (rename regions/places, labels);
    every other field is kept verbatim.
  - A write produces an `AiChange` on its tool call (`types.ts`): summary, preview (paragraph hunks →
    word diff, or a +/−/→ list; `lib/ai/diff.ts`), status `pending/applied/rejected/undone/failed`,
    the `before` content and a hash of the text after. `AiChangeCard` renders it with Apply/Reject or
    Undo; a reply with several changes gets Apply all / Undo all.
  - **Undo** (`useAiChat#undo`) restores `before` (or deletes a created document). If the document's
    text no longer matches the stored hash, the card asks "Undo anyway?" first (later edits would be lost).
  - **App bridge** (`AiDocumentBridge`, built in `App.tsx`, passed to `AiScope` on both shells): reads
    documents via refs (including the open one's unsaved edits), writes + saves at once, refreshes the
    open document — the editor applies external content in place; canvases (which read their document
    on mount) are remounted via a per-document revision key. Before any read or write,
    `lib/canvasFlush.ts` pushes the canvases' debounced (400 ms) edits through, so nothing is read stale.
  - A pending proposal badges the ✦ AI button (desktop, via `AiScope#onAttentionChange`) and the AI tab.
- **Inline commands (Phase 4).** Polish, Proofread, Fix grammar, Shorten, Expand, Change tone (6
  tones), Continue writing — catalogue and prompts in `lib/ai/inline.ts`. Each is **one tool-less
  request** to the project's AI (`client.ts#runInlineTurn`; not stored in any chat session); the
  result is always a preview the writer accepts, whatever the chat mode.
  - **Where:** `/polish` etc. in the slash menu (an "AI" group, shown only when the project has an
    AI); desktop: Ctrl/⌘+J or the ✦ button beside a selection opens a command menu; the Format panel
    and the phone Tools sheet have an AI section (`controls/AiInlineControls.tsx`).
  - **Scope:** the selection, else the paragraph at the cursor (or the nearest non-empty one above);
    Continue writes after the cursor's paragraph. Up to ~1,500 chars before the passage go along as
    context (4,000 for Continue).
  - **Editor side:** `extensions/AiTarget.ts` highlights the passage (`.mn-ai-target`, breathing while
    running), keeps that range mapped through edits made meanwhile (never in undo history), binds
    Mod-J, and holds the controller `InlineAi` registers (`inlineAi(editor)` is how the slash menu,
    Format panel and Tools sheet start commands). `components/ai/InlineAi.tsx` = the card (streams,
    word diff for Proofread/Grammar by default, "Show changes" toggle, tone chips, Accept = Ctrl/⌘+Enter,
    Esc discards, Retry), the menu and the selection button. Desktop: card floats under the passage;
    phone: docks to the bottom of the editor and pads the page so the passage scrolls above it.
  - **Accept** (`lib/ai/rewrite.ts`): `flatten` maps the passage to text with a document position per
    character; `applyRewrite` word-diffs old → new and applies only the changed words in one
    transaction (marks on kept words survive; one Ctrl+Z). If the paragraph count changes, or the
    writer edited the passage meanwhile, it replaces the range with plain paragraphs instead.
- **Phone pairing.** A phone uses the PC's Claude Code over the home Wi-Fi (provider `paired`, phone
  only). PC: `ai/pair_server.rs` — off until Settings → AI → Phone pairing is on (persisted in
  `<data>/pairing/server.json`, autostarts), TCP on 47815 (or a free port) + UDP discovery on 47815,
  minimal one-request-per-connection HTTP, streamed NDJSON replies flushed per event with a blank-line
  keep-alive every 20 s (a vanished phone cancels its turn). Phone: `ai/pair_client.rs` — UDP
  discovery, pairing, and `run` (relays the turn; tool calls from the PC run on the phone through the
  normal engine path; Stop sends `/v1/cancel`; re-finds the PC by id if its IP changed). Crypto
  (`ai/pair_crypto.rs`): an 8-digit code, 5-minute window, ≤5 tries, run through SPAKE2 (no offline
  guessing); the PC hands out a per-phone 32-byte key sealed under that SPAKE key and keeps the device
  only after the phone proves it holds it (`/v1/hello`). Every later message is XChaCha20-Poly1305
  sealed with associated data binding direction, path, device, request id and line number;
  timestamps (±10 min) + request-id memory stop replays. Paired phones can only run Claude Code turns
  (model alias validated). Removing a device revokes it at once. Keys live in the app's data folder
  (PC) and app-private storage (phone, `secrets/paired-pc.json`).
- **Settings → AI (Phase 5).** `components/ai/AiSettings.tsx` (`variant` desktop | mobile, state in
  `lib/ai/useAiSettings.ts`), in `SettingsPanel` and `MobileSettings`: **Claude subscription** (desktop:
  account, plan, Claude Code version, limit bars parsed by `usage.ts#parseCliUsage`, refresh;
  sign-in hint when needed), **API keys** (add / replace / remove per provider, status only — keys are
  never read back), **Assistant** (default mode for projects that haven't chosen one, pref
  `mnemo_ai_mode` read by `resolveConfig`; today / 7-day tokens and cost per provider).
  - The editor gets the AI as `ai: InlineAiHost` (`lib/ai/inlineHost.ts#inlineHostFor`, built in App
    and MobileShell from the chat state, with `openConnect` = AI panel / AI tab on the Connect screen).

## Styling
Theme tokens (6 themes) live in `src/index.css` (`body.theme-*` CSS variables + Tailwind v4
`@theme`). Feature CSS (`.mindmap-*`, `.slash-menu`, `.editor-image`) is appended there.
Note: `src/App.css` is **legacy and not imported** — don't edit it; use `index.css`.

## Validate before committing
`cd app && npm run lint && npx tsc -b && npm run build` · `cd app/src-tauri && cargo check`.
Lint must be at **0 errors** (React Compiler rules: never read `ref.current` during render — mirror
into state; never call setState synchronously in an effect body).
