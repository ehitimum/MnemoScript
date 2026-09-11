# Testing MnemoScript

Three layers, all run by CI (`.github/workflows/ci.yml`) on every push:

| Layer | Tool | Where | Run |
|---|---|---|---|
| Frontend unit | Vitest + jsdom | `app/src/**/*.test.ts` | `npm test` |
| Frontend regression (mounted components, real TipTap / React Flow) | Vitest + Testing Library | `app/src/regression/*.regression.test.tsx` | `npm run test:regression` |
| Backend unit | `cargo test` | `app/src-tauri/src/{project,lib}.rs` (`#[cfg(test)]`) | `cd app/src-tauri && cargo test` |

`npm run check` runs lint → type check → all Vitest suites → production build. Backend tests need
`app/dist` to exist (the Tauri crate embeds it), so run `npm run build` first on a clean checkout.

## What is covered

**Unit (47 tests)**
- `lib/platform` — shell selection: narrow desktop stays desktop, Android always phone, touch+narrow
  browser is phone, `?shell=` override, Tauri detection.
- `lib/proseFlatText` — flat-text ↔ ProseMirror offset map (block separators, marks, lists, empty docs).
- `fantasymap/heightmap` — grid sizing, seeded RNG, noise determinism/normalisation, sea level,
  brush raise/carve (incl. 3 px rivers), marching-squares coastline, chained + smoothed polylines,
  ruggedness warp + cache invalidation.
- `fantasymap/mapTypes` — defaults, legacy migration (classic/no chrome), corrupt JSON, round-trip,
  region tiers, ids.
- `fantasymap/generator` — reproducibility per seed, region cap, icons on land, scatter toggles,
  ink captions, density.
- `lib/api` — the browser fallback backend (same command surface as Rust).

**Regression (18 tests)** — each pins a bug fixed in the 2026-09-11 pass:
- Sidebar icons follow `docType`; auto-numbered chapters; filter.
- Editor: keyed mount, smooth-caret overlay + native-caret class toggle, edit echo does not reset the
  caret, external content applies, empty-doc fallback, `onEditorReady(null)` on unmount, mobile chrome.
- MindMap: pending edit flushed on unmount with its `docId`; Save flushes first; no update on mount.
- App: desktop welcome vs. phone shell; project + chapter creation with the empty state; **edits are
  saved when switching documents**; **a late canvas flush lands in the right document**.

**Backend (10 tests)** — atomic write, safe folder/file names (path traversal), project round-trip
with content-free `project.json`, registry add/forget, corrupt document tolerance, ordering + idempotent
delete, legacy `project.json` without new fields, missing-document errors.

## jsdom notes
`src/test/setup.ts` stubs `ResizeObserver`, `matchMedia`, `fetch` (LanguageTool is never contacted),
`scrollIntoView` and `elementFromPoint` (ProseMirror's viewport plugin). Konva needs a real canvas, so
the map *studio* component is not mounted in jsdom; its engine (`heightmap`, `generator`, `mapTypes`)
is covered instead.

## Manual device checklist (before a release)
Things jsdom cannot prove — run on Windows (packaged app) and an Android phone:
1. Type in a chapter: the caret glides, stays solid while moving, blinks at rest, hides on selection
   and when the window loses focus; IME/autocomplete on Android shows the native caret while composing.
2. Switch documents with unsaved edits, then reopen the app → edits are there. Close the window with
   unsaved edits → they are saved (desktop). Background the app on Android → saved.
3. Fantasy map on the phone: land/sea brush strokes start on touch, two fingers pinch/pan, region drawing,
   PNG export lands in `<project>/exports/`. Desktop: export opens Save-as.
4. Read-aloud and dictation still start (WebView permission prompts).
5. Web build in a phone browser gets the bottom-tab shell; a narrow desktop window keeps the desktop UI.
