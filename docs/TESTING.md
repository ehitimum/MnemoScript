# Testing MnemoScript

Use Node 24.15.0 from the root `.node-version` (supported range: 24.15+ in 24.x). Both CI and
release workflows read this file. Locked jsdom 30/undici 8 cannot start under the former Node 20
CI runtime. `regression/runtime.regression.test.ts` exercises jsdom in a fresh Node worker.

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

**AI assistant** (added 2026-11-12)
- Unit `lib/ai/ai.test.ts` — model labels/vendors, phone provider list, document → text, tool mode
  enforcement, context replay across models, session reducer, `runTurn` tool round trip, per-project
  session storage.
- Unit `lib/ai/edits.test.ts` — text edits (formatting kept, quotes/markers/spacing, cross-paragraph,
  delete/insert/split, missing/ambiguous, all-or-nothing), light markdown → HTML, diffs, mind map and
  fantasy map edits, write tools per mode (plan refuses, auto applies with undo data, ask waits and
  re-reads on approval, reject), session storage/replay of change outcomes.
- Unit `lib/ai/inline.test.ts` — inline prompts and output cleanup, `runInlineTurn`, and
  `flatten`/`applyRewrite`/`insertParagraphsAfter` against a real TipTap editor (marks kept, one undo
  step, structural fallback, stale-text refusal), `AiTarget` range mapping.
- Backend `cargo test pair` — pairing crypto, and an end-to-end loopback test of the PC server + phone
  client (pairing, relayed turn with a tool call, wrong code, revocation, replay).
- Unit `lib/ai/usage.test.ts` — `/usage` report parsing (real captured text), local usage totals,
  default mode for unconfigured projects.
- Regression `regression/ai.regression.test.tsx` — desktop panel (Ctrl+L, connect screen, a full mocked
  turn saved to the right project with its model), Ask → Apply → Undo on the open chapter (formatting
  and word count follow), Plan mode makes no edits, `/polish` from the slash menu → preview → Accept
  keeps bold → Ctrl+Z, Settings (desktop limit bars / account / default mode; phone without the
  Claude card), phone AI tab (needs a project, API-key providers only,
  tab bar hides while the composer has focus).
- Backend `cargo test ai::` — SSE parsing, the three API stream accumulators, Claude Code stream-json,
  MCP JSON-RPC, turn registry/cancel, session files, key storage. Live (costs a little usage, so
  `#[ignore]`d): `cargo test live_claude_code -- --ignored --nocapture` (the round trip costs a
  little; `live_claude_code_usage` is free). Codex: `cargo test live_codex -- --ignored --nocapture`
  (a little of the ChatGPT plan).
- UI work in a browser: `npm run dev`, open `http://127.0.0.1:1420/?aimock` (add `&shell=mobile` for the
  phone). `?aimock` (or `localStorage['mnemoscript:aimock']='1'`) turns on `lib/ai/devMock.ts`, a fake
  provider for the browser fallback only — never in the Tauri app. A message with "edit", "fix" or
  "polish" (Ask/Auto) makes the mock read the open document and change it. Inline commands get a
  crude mock rewrite (drops "very", adds a comma) or two "continued" paragraphs.
- The App-mounting suites warm `import('../App')` in `beforeAll`: a cold parallel import could exceed
  the 15 s test timeout and cascade into duplicate-render failures.

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
