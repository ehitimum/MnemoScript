# MnemoSync Project Memory (Development Handoff)

> **Scope:** This is a project-specific handoff note for MnemoScript developers and coding assistants. It is **not** a dump of ChatGPT's private memory, hidden reasoning, credentials, or user profile. Update it alongside implementation.

## Goal

Implement optional, secure, low-cost **local-first project synchronization** for Windows (Tauri 2), Android (Tauri mobile), and web (React/Vite) without a MnemoScript-operated server:

- **MnemoLink:** native devices discover each other on LAN; one-time explicit pairing and project grant, then automatic trusted reconnection and encrypted peer sync.
- **MnemoDrive:** user authorizes their own Google Drive `appDataFolder`; multiple devices signed into the same Google account share project revisions through Drive. The web app uses Drive first.
- **Smart Project Merge:** safely link independent copies of a novel, including the real example of **desktop `Volume 1` with chapters under it vs Android root-level chapters**. Preserve divergences and extra chapters, choose a canonical hierarchy and UUID, not a permanent master device.

## Baseline inspected 2026-11-12

- Repo: `ehitimum/MnemoScript`; **`main` is old** (`6a54d255724a...`).
- PR #1 `feature/ai-assistant` -> `main` is **open**. Latest inspected feature commit: `0f15939e2f309d0021575e69ebe9075843b1a9f6`.
- Feature branch has v2, v2.1 AI, phone AI pairing and **new Codex CLI support** (after v2.1 tag). Start sync development from the integrated feature-branch HEAD / post-merge main, not from stale main.
- Native files: `app/src-tauri/src/project.rs`: `<project>/project.json` with metadata/folders/content-free document index, `documents/<id>.json` with authoritative content, assets under `assets/`, AI sessions under `ai/sessions/`.
- Web fallback: `app/src/lib/api.ts` uses `localStorage` for projects and AI sessions; must migrate to IndexedDB for real sync.
- Project data: `app/src/types.ts`; document types are text, mindmap, fantasymap. Folder references use `folderId`, folders use `parentId`, `order`.
- Assets: `app/src/lib/assets.ts`, `mapAssets.ts`; current serialized content can contain **absolute local paths**. Migrate to stable asset URIs/hashes.
- Existing AI pairing: `app/src-tauri/src/ai/pair_server.rs`, `pair_client.rs`, `pair_crypto.rs`; PC listening TCP/UDP 47815, broadcast discovery, short pairing code, SPAKE2 and XChaCha20-Poly1305. This grants **AI access only**. Do **not** silently extend it to manuscript access or share secrets without explicit authorization.
- `App.tsx` flushes pending document changes; sync must enqueue durable changes after successful local writes and preserve live editor state.
- Run `npm run check`, `cargo test`, `cargo clippy -- -D warnings` before PRs; add regressions for every data-loss bug.

## Locked decisions for implementation

1. Save local first. Serverless Drive is **transport/storage, not a transactional database**. Never use mutable single-project ZIP as the simultaneous multiwriter source of truth.
2. Use **stable UUIDs, immutable operations, parent revision IDs/hash DAG, per-device sequence and unique operation IDs**, idempotent replay, tombstones, explicit conflict heads. **Never last-write-wins solely by timestamp**.
3. Use a single common `SyncTransport`, implemented for LAN and Drive; identical `operationId`s deduplicate cross-transport delivery. Track receipts separately for each enabled transport.
4. Native JSON persists; add separate **SQLite sync state** (outbox, revisions, IDs, intent recovery); use **IndexedDB** for web. Crash recovery must reconcile JSON writes with durable queue.
5. Smart Merge is first-class. The writer selects preferred folder tree (`Volume 1` on desktop) and canonical project identity. Mobile root chapters can map into Volume 1 without changing their text. Identical items deduplicate, mobile-only Chapter 4 imports, divergent Chapter 3 asks for manual review. Snapshot both originals and stage safely before commit.
6. Devices auto-**discover** on Wi-Fi, but first-time trust and project access need confirmation. After that, auto-reconnect. Keep separate sync grants and crypto purpose from AI pairing.
7. Browser LAN is **not required for MVP**: no arbitrary UDP browser discovery, browser local-network permissions differ. First launch uses Drive; optional user-initiated LAN via desktop endpoint after browser compatibility proof.
8. Google OAuth: `drive.appdata` non-sensitive scope, correct desktop/Android/web clients within same Google application; validate cross-client appData access early. Native tokens stored securely; web browser token model may require user reauthorization; never store refresh token in localStorage.
9. Drive's hidden appData is **flat** and user-owned; use opaque object names/metadata and immutable change batches/blobs. A successful blob upload does not mean batch published; publish manifest last. Use changes feed cursors, handle duplicates/401/429/reset. Exports/backups are distinct from sync.
10. AI sessions, exports, CLI credentials, API keys and local registry paths do **not** sync by default. Add optional AI session sync later. Privacy/security are mandatory.

## Concrete next work, in order

- [x] Verify current branch/PR #1 again, merge or branch from its integrated HEAD.
- [x] Add architecture ADR, threat model and a lossless ZIP backup/restore command (device acceptance pending).
- [~] Implement SQLite sync state + web IndexedDB storage and migrations. *(native SQLite done; web not)*
- [x] Build asset portability: `mnemo-asset:` refs in synced content, disk format unchanged (no migration).
- [ ] Implement Smart Merge candidate matching, desktop Volume 1 vs mobile root mapping, side-by-side chapter conflicts, alias IDs and non-destructive commit.
- [x] Implement revision DAG, durable outbox/inbox, tombstones, generic SyncTransport and randomized replay tests.
- [ ] Add separate LAN sync handshake/crypto/authorization and test Windows + Android on real Wi-Fi.
- [~] Implement Google OAuth: desktop loopback+PKCE and Android native authorization done; web not; live cross-client `appDataFolder` proof pending.
- [x] Implement Drive change feed, immutable batches, blobs, resumable uploads, quota backoff and account switch handling.
- [~] Sync status UI and conflict review done; hybrid fan-out, recovery UX and hardware reliability tests open.

## Implementation update — 2026-11-13 (Google Drive)

- Branch `codex/mnemosync-drive` (stacked on `codex/mnemosync-backup`). Design as built, setup
  steps and open items: `docs/MNEMOSYNC_DRIVE.md`. Review of PRs #2/#3 found local sync
  (Phases 1–4) unbuilt; the engine was built here, transport-neutral, before the Drive transport.
- Fixed: restore left fantasy-map `imports[].path` pointing at the original project; imported
  images were written non-atomically; forgotten projects kept syncing; Vitest one-worker-per-core
  starved App-mounting suites (AI mock waits widened, workers capped at 50%).
- Not verified: live Google OAuth, real desktop ↔ Android sync, quotas. Needs the writer's own
  Desktop + Android OAuth clients in one Cloud project (`app/src-tauri/.env.local`).

## Implementation update — 2026-11-12

- Reverified PR #1 through the GitHub connector: open, feature HEAD remains `0f15939e2f30`;
  development branches from that HEAD. No merge of PR #1 was performed.
- Extracted this package under `docs/mnemosync/`. Added strategy/ADRs, threat model,
  schema/migration contract and a test matrix as `docs/MNEMOSYNC_*.md`.
- Initial Phase 0 code: `src-tauri/src/backup.rs` + tests, `backup_project` and raw-binary
  `restore_project_backup` commands; version-1 recovery ZIP manifest with per-file SHA-256.
  Archives include chapters/maps/assets/sessions/exports, exclude app secrets/registry/grants.
- Restores stage and verify a new local project with a fresh UUID and `(restored)` name suffix;
  originals stay intact. Remap only image attributes/known map image fields, including Windows
  paths, HTML entities and all three fantasy-map asset fields; keep prose and graph IDs.
- BackupSettings reuses desktop cards and phone rows, has progress/errors/retry, local archive
  creation, optional Save a copy and a file picker for restore. Browser labels native-only
  availability honestly. App saves dirty content first and aborts backup if that save fails.
- Tooling: ZIP 9.5 requires Rust 1.88; added SHA-256, HTML rewriting/entity parsing and tempfile
  tests. No SQLite/IndexedDB/portable asset migration or transport enabled yet.
- Automated evidence and pending manual gates are recorded in `MNEMOSYNC_TEST_MATRIX.md`.
  Browser visual verification was blocked by denied local-preview permission; do not retry
  via alternate browser tooling. Installed Windows/real Android acceptance remains pending.
- Next: finish Phase 0 device acceptance, then Phase 1 durable SQLite/IndexedDB intents and
  portable assets. Google client setup and real LAN/Drive tests are still future work.
- Final local checks: 130 frontend tests, 41 regression tests, frontend lint/types/build,
  cargo check, 56 Rust tests (3 existing live-AI tests ignored), Clippy -D warnings pass.
  Strategy baseline commit: `5b34ff1` on `codex/mnemosync-foundation`; implementation branch:
  `codex/mnemosync-backup`. PR publication status must be checked, not inferred from a push.
- Published [strategy/runtime PR #2](https://github.com/ehitimum/MnemoScript/pull/2) against
  `feature/ai-assistant`, and [draft recovery PR #3](https://github.com/ehitimum/MnemoScript/pull/3)
  against `codex/mnemosync-foundation`. Preserve this stack until prerequisites merge.
- CI exposed inherited Node 20 incompatibility with locked jsdom/undici. Shared fix `2fb06b5`
  pins Node 24.15.0 in `.node-version`, updates CI/release/package engines and adds a clean-worker
  DOM startup regression; integrated into the implementation branch. Remote runs are separate
  from local verification and need independent status review.
- The now-running Linux tests exposed a pre-existing fast-response AI undo grouping bug.
  Shared fix `8b4977b` isolates rewrites/continuations from adjacent typing; three fixed-clock
  regressions verify both history boundaries. Integrated into both PRs; no UI format change.

## Critical scenario / regression test

**Desktop:** `Novel` -> `Volume 1` -> `Chapter 1`, `Chapter 2`, `Chapter 3`, `Mind Map`.  
**Mobile:** `Novel` -> root `Chapter 1`, `Chapter 2`, `Chapter 3`, `Chapter 4`, `Mind Map`; some content differs; UUIDs may be unrelated.

**Expected:** show candidate pairing, require merge approval; choose desktop folder structure and canonical project UUID; mobile root chapters matched to corresponding Volume 1 docs (metadata-only folder mismatch is not content conflict); Chapter 4 imported under Volume 1; divergent Chapter 3 shown in a conflict preview; mind map conflict handled separately; all original source data backed up and unchanged until explicit cleanup. Both replicas end on the same logical project identity; neither becomes a permanent master. Sync via LAN and Drive without duplicate Chapter 4.

## Security and cost constraints

- No required MnemoScript-hosted sync server, no project-wide shared service account, no full-drive OAuth scope.
- Never claim `Drive sync` == end-to-end encryption or backup. Drive app data can be deleted independently and is invisible in Drive UI.
- Standard Drive API usage has quotas measured in request units and Google has announced potential billing for quota overages later in 2026. Batch operations, monitor API usage and back off on errors.
- LAN encrypt every project operation and blob; enforce per-project grants, device revocation, limits and path sanitization.
- Browser local network access must be initiated by explicit user gesture on HTTPS and observed permission/CORS policy; avoid assuming every browser supports it.

## Documentation / references

- Full plan: [`MnemoSync_Full_Development_Plan.md`](./MnemoSync_Full_Development_Plan.md)
- GitHub PR: https://github.com/ehitimum/MnemoScript/pull/1
- Current feature branch: https://github.com/ehitimum/MnemoScript/tree/feature/ai-assistant
- Google Drive app data: https://developers.google.com/workspace/drive/api/guides/appdata
- Drive change feed: https://developers.google.com/workspace/drive/api/guides/manage-changes
- Drive usage limits: https://developers.google.com/workspace/drive/api/guides/limits
- Browser Local Network Access: https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access

**Maintenance rule:** update this file after each implemented phase with schema migrations, tests, changed APIs, unresolved risks, and new PR/commit baselines. Never add real Google tokens, device pairing keys, author manuscripts, or sensitive logs to a repository memory file.
