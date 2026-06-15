# MnemoScript - Writer's Productivity Tool

MnemoScript is a desktop application for writers to write, organize, and plan their work efficiently. This is the first prototype implementing Phase 1 Sprint 1 user stories.

## Overview

This is built using **Tauri** (Rust backend + Web frontend) with a React + TypeScript frontend,
featuring a rich text editor, a visual mind map, a Notion-style slash menu, image embedding, and a
project-to-PDF book compiler. Projects, documents, and images are stored on disk via the Rust
backend. For architecture details see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); for the change
history see [docs/DEVLOG.md](docs/DEVLOG.md).

### Features

- **Projects on disk** – create/open projects; each is a real folder with per-document files and an
  `assets/` image folder. Auto-save + manual save persist to disk.
- **Rich text editor** – bold, italic, headings, lists, live word count, grammar checking.
- **Slash "/" menu** – Notion-style block inserter: headings, lists, quote, code block, divider,
  and image.
- **Image embedding** – `/image` opens a native picker; the file is copied into the project and
  embedded, rendered through Tauri's asset protocol.
- **Mind map** – a draw.io-style canvas (React Flow): draggable nodes, drawn connectors, colors,
  pan/zoom. Created from the explorer's "New MindMap".
- **Compile to PDF book** – File → "Compile to PDF Book": set title/author, pick & reorder
  chapters, toggle cover/table-of-contents, export via Save-as-PDF.
- **Themes** – six color profiles, typography controls.

## Getting Started

### Prerequisites

1. **Node.js** (LTS version) – [Download](https://nodejs.org/)
2. **Rust** with `rustup` – [Install](https://rustup.rs/)
3. **Windows C++ Build Tools** (for MSVC linker) – Install via Visual Studio Build Tools or the `windows‑sdks` component.
4. **Tauri CLI** – installed automatically via npm script.

### Installation

1. Clone or extract the project.
2. Open a terminal in the project root (`F:\MnemoScript`).
3. Navigate to the `app` folder:
   ```bash
   cd app
   ```
4. Install frontend dependencies:
   ```bash
   npm install
   ```
5. Build the Rust backend (requires C++ tools):
   ```bash
   cd src-tauri
   cargo build
   ```
   If you encounter linker errors, ensure you have the MSVC toolchain installed (e.g., via `rustup target add x86_64‑pc‑windows‑msvc` and the Visual Studio C++ build tools).

### Running the Application

From the `app` directory, run:

```bash
npm run dev:tauri
```

This will start the Tauri development server, open the application window, and enable hot‑reload for frontend changes.

## Project Structure

```
MnemoScript/
├── docs/                           # Original user stories and documentation
├── app/                            # Main application (frontend + backend)
│   ├── src/                        # Frontend React source
│   │   ├── components/             # React components
│   │   │   ├── Sidebar.tsx        # File explorer / document creation
│   │   │   ├── Editor.tsx         # Rich text editor (TipTap)
│   │   │   ├── MindMap.tsx        # React Flow mind-map canvas
│   │   │   ├── BookCompiler.tsx   # Project → PDF book modal
│   │   │   ├── SlashMenu.tsx      # "/" command palette UI
│   │   │   └── extensions/        # TipTap: SlashCommand, ImageWithAsset, slashItems
│   │   ├── lib/                   # api.ts (backend wrapper), assets.ts (asset URLs)
│   │   ├── types.ts               # TypeScript interfaces (Project, Document)
│   │   ├── App.tsx                # Main application layout + persistence
│   │   ├── index.css             # Themes + component styles (App.css is legacy/unused)
│   │   └── main.tsx               # Entry point
│   ├── src‑tauri/                 # Rust backend
│   │   ├── src/
│   │   │   ├── lib.rs             # Tauri commands and setup
│   │   │   └── project.rs         # Project/Document data structures and file I/O
│   │   ├── Cargo.toml             # Rust dependencies
│   │   └── tauri.conf.json        # Tauri configuration
│   ├── vite.config.ts             # Vite configuration for Tauri
│   └── package.json               # Frontend dependencies and scripts
└── README.md                      # This file
```

## User Stories Covered (Sprint 1)

| Story | Status | Notes |
|-------|--------|-------|
| Create a new writing project | ✅ | Project saved to `~/.mnemoscript/projects/<id>/project.json` |
| Open an existing project | ✅ | Loads project metadata and all documents |
| Create a new document within a project | ✅ | Document saved as `<id>.json` in project’s `documents/` folder |
| Write/edit text in a rich text editor | ✅ | TipTap editor with bold, italic, headings, lists |
| Live word count | ✅ | Updates on each keystroke |
| Auto‑save every 30 seconds | ✅ | Timer‑based save; manual save button also available |

## Development

### Frontend

The frontend is a React application using:

- **Vite** for fast builds and HMR
- **TypeScript** for type safety
- **TipTap** for the rich‑text editor
- **Tauri API** for invoking backend commands

Key components:

- **`Sidebar`** – lists projects, allows creating new projects.
- **`Editor`** – rich‑text editing toolbar, word count, auto‑save timer.

### Backend (Rust)

The backend uses Tauri’s `#[tauri::command]` system to expose safe file‑system operations.

- **`project.rs`** – defines `Project` and `Document` structs, handles serialization, and reads/writes to `~/.mnemoscript/projects/`.
- **`lib.rs`** – registers Tauri commands (`create_project`, `load_project`, `create_document`, `save_document`, etc.).

Data is stored as JSON in the user’s home directory, preserving the hierarchy:

```
~/.mnemoscript/projects/
├── <project‑id>/
│   ├── project.json               # Project metadata
│   └── documents/
│       ├── <document‑id>.json     # Document content
│       └── ...
└── ...
```

### Commands Available

| Command | Parameters | Returns |
|---------|------------|---------|
| `create_project` | `name`, `description?`, `path?` | `Project` |
| `save_project` | `project: Project` | `()` |
| `load_project` | `project_id: String` | `Project` |
| `list_projects` | – | `Vec<Project>` |
| `open_project_by_path` | `path: String` | `Project` |
| `create_document` | `project_id`, `title`, `content`, `doc_type?`, `order?` | `Document` |
| `save_document` | `project_id: String`, `document: Document` | `()` |
| `load_document` | `project_id: String`, `document_id: String` | `Document` |
| `import_image` | `project_id: String` | `Option<String>` (copied image path) |
| `select_directory` | – | `Option<String>` |

All commands return an `ApiResponse<T>` wrapper with `success`, `data`, and optional `error`
fields. The frontend calls them through the typed wrapper in `app/src/lib/api.ts`.

## Building for Windows

To create a standalone Windows executable:

```bash
cd app
npm run build:tauri
```

The output will be placed in `src‑tauri/target/release/`. You can distribute the `.exe` along with the necessary resources (see Tauri documentation for bundling).

## Future Work (Next Sprints)

This prototype implements only Sprint 1. Upcoming sprints will add:

- **Sprint 2** – Sidebar file explorer, folders, drag‑and‑drop, search, delete with undo.
- **Sprint 3** – Export to Markdown/plain text, outline creation, word‑count goals, statistics.
- **Phase 2** – Web version, cloud sync, authentication, collaboration.

## Troubleshooting

### Linker errors on Windows

Ensure you have the **Microsoft C++ Build Tools** installed. You can install them via the Visual Studio Installer (select “Desktop development with C++”) or download the standalone Build Tools.

After installation, verify that `link.exe` is in your `PATH`. Alternatively, set the environment variable `VCINSTALLDIR` to point to your Visual Studio installation.

### Tauri dev server fails to start

Check that `cargo build` succeeds. If there are Rust compilation errors, run `cargo check` for details.

### Frontend changes not reflecting

Make sure you are running `npm run dev:tauri` (not just `npm run dev`). The Tauri dev server proxies the Vite dev server and injects the Tauri API.

## License

Proprietary – All rights reserved.

---

*This prototype was built following the user‑story‑driven development plan. Feedback and contributions are welcome.*