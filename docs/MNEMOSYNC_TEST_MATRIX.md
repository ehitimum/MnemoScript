# MnemoSync verification matrix

Baseline on 2026-11-12: `npm run check` passed lint, types, 116 existing tests and production build.
Large-bundle warnings predate this change. Run required checks again after the implementation.

Implementation verification, 2026-11-12: `npm run check` passes lint, typecheck, all **126 tests**
and production build; `npm run test:regression` passes **37 mounted regressions**. `cargo check`
passes; `cargo test` passes **56 tests** (including 11 new archive tests), with the 3 existing
live-AI tests intentionally ignored; `cargo clippy -- -D warnings` passes. The existing pairing
test needs permission for loopback network access. No live provider usage was consumed.
Visual preview was retried after user authorization but a saved permission policy still blocks
the local origin. Generated Rust app artifacts were cleaned after E: filled up; sources and
saved projects were unaffected. Filesystem hard-link fallback warnings are environmental.

| Layer | Required evidence | Scope |
|---|---|---|
| Native archive unit | Exact bytes, hierarchy, Unicode/HTML marks, graph IDs, paths, sessions/exports, repeated restore | `cargo test backup::` |
| Native rejection | Corruption, truncation, missing/extra files, unsafe paths, symlinks, size/version mismatch, folder cycles | No activated or staged partial result on ordinary failure |
| Mounted UI/UX | Desktop/phone variants, no-project restore, busy states, accessible errors, cancel/retry, oversize before read, duplicate requests | `regression/backup.regression.test.tsx` |
| App regression | Dirty chapter saved before snapshot; local save failure prevents backup | `regression/backup-app.regression.test.tsx` |
| Existing behavior | All previous editor, maps, AI, pairing, project storage tests | `npm run check`, `npm run test:regression`, `cargo check`, `cargo test`, `cargo clippy -- -D warnings` |
| Visual layout | Desktop and phone settings, theme contrast, long paths, keyboard and touch | Pending: local browser preview access was denied by the permission gate; do not claim screenshots reviewed |
| Installed Windows | Custom-path project, image and map render after restore, library includes original and copy, external ZIP copy | Pending real app acceptance |
| Real Android | App-private backup, ZIP chooser, Save a copy provider access, restore, reopen, image/map render | Pending real device acceptance |

## Synthetic corpus for every storage/merge phase

Use synthetic writing only, never the user's manuscripts in committed fixtures.

- Desktop Novel / Volume 1 / Chapters 1–3 / Mind Map; mobile Novel / root Chapters 1–4 / Mind Map.
- Distinct project/doc/folder UUIDs. Chapter 1 identical, Chapter 2 folder-only difference,
  Chapter 3 divergent, Chapter 4 phone-only. Both map snapshots diverge.
- Rich HTML marks, lists, Unicode, embedded images; imported fantasy-map item, background image
  and baked terrain; custom Windows path and Android app-private paths; per-project AI sessions.
- Missing/corrupt document file, missing asset, invalid folder reference, cycle, unsafe archive,
  stale timestamp, interrupted write, full disk, app killed, stale cloud cursor and account change.

## Later release gates (not implemented/tested)

Smart Merge must back up both originals, preview matching/placement separately from content,
preserve divergent Chapter 3, import Chapter 4 once and survive interruption. Randomized
multi-replica replay must converge without timestamp wins or stale resurrection. LAN requires
real Wi-Fi/device grants/revocation; Drive requires same-account cross-platform OAuth proof,
expiry/quota/cursor recovery and no account mixing. Hybrid tests must apply identical IDs once
and keep each transport pending until its own receipt. Test Android suspension and live-editor
composition, plus diagnostic content redaction and staged rollback, before release.
