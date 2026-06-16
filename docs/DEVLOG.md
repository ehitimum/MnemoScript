# MnemoScript Development Log

A running log of substantive changes, so future work needs less re-discovery.
Newest entries first. Dates are absolute.

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
