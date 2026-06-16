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
`create_project` · `save_project` · `load_project` · `list_projects` · `open_project_by_path` ·
`create_document` (takes `docType`/`order`) · `save_document` · `load_document` ·
**`import_image`** (picker → copy to `assets/` → returns absolute path) · `select_directory`.

## Frontend layering
- **`src/lib/api.ts`** — the *only* place that calls `invoke`; typed, unwraps `ApiResponse`, throws
  on failure. Always go through this.
- **`src/lib/assets.ts`** — `toAssetUrl(path)` and `resolveImagesInHtml(html)`. Image `src` is
  stored as a raw disk path and resolved to a Tauri asset URL (`convertFileSrc`) only at render
  time. Asset protocol is enabled in `tauri.conf.json` (`app.security.assetProtocol`) +
  `Cargo.toml` (`protocol-asset` feature).
- **`App.tsx`** — owns app state, persistence (auto-save loop + manual save via refs), and routing:
  renders `<MindMap>` for `docType==='mindmap'`, else `<Editor>`. localStorage holds only UI prefs.

## Editor extensions (`src/components/Editor.tsx`)
`StarterKit` (+ heading/list keymaps) · `Placeholder` · `LinguisticCheck` (grammar) ·
**`ImageWithAsset`** (asset-rendering image node) · **`SlashCommand`** (the `/` menu).
The slash menu (`SlashCommand.ts` + `SlashMenu.tsx` + `slashItems.ts`) is built on
`@tiptap/suggestion`; its React popup is positioned at the caret via the suggestion `clientRect`
(same manual technique as the grammar popover — no tippy.js).

## Feature components
- **`MindMap.tsx`** — React Flow canvas; serializes `{nodes,edges}` to `content` (debounced).
- **`BookCompiler.tsx`** — File → "Compile to PDF Book": builds a print-CSS book HTML in a hidden
  iframe and calls `print()` → "Save as PDF". Text chapters only (mind maps excluded for now).

## Styling
Theme tokens (6 themes) live in `src/index.css` (`body.theme-*` CSS variables + Tailwind v4
`@theme`). Feature CSS (`.mindmap-*`, `.slash-menu`, `.editor-image`) is appended there.
Note: `src/App.css` is **legacy and not imported** — don't edit it; use `index.css`.

## Validate before committing
`cd app && npm run lint && npm run build` · `cd app/src-tauri && cargo check`.
