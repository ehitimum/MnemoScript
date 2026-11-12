# MnemoSync implementation strategy

Baseline verified 2026-11-12: local `feature/ai-assistant` and open PR #1 both point to
`0f15939e2f309d0021575e69ebe9075843b1a9f6`. Main is still `6a54d255724a`.
New work branches from that feature HEAD, without merging or altering PR #1.

The supplied [development plan](mnemosync/MnemoSync_Full_Development_Plan.md) and
[handoff memory](mnemosync/MEMORY.md) are reference inputs. They are not authorization to
merge existing PRs, provision accounts, expose manuscripts, or claim unperformed testing.
The requested work authorizes implementation, testing and new PRs.

## Delivery order

| Slice | Deliverable | Gate before proceeding |
|---|---|---|
| 0a | This strategy, ADRs, threat model, test matrix, supplied plan | Verify branch baseline and preserve existing AI work |
| 0b | Native checksummed recovery ZIPs and settings controls | Round-trip chapters, hierarchy, maps, assets, sessions and exports without changing originals; desktop/Android acceptance remains explicit |
| 1 | Native SQLite sync state, web IndexedDB migration, portable hashed assets | Crash-safe local saves/outbox; old projects and browser data preserved |
| 2 | Smart Merge preview, alias mapping and journaled staging | Volume 1 vs root fixture; keep divergent Chapter 3 and import Chapter 4 once |
| 3 | Revision DAG, tombstones, durable replay, transport interface | Reordered/duplicated/lost-message simulations and concurrent edits |
| 4 | Separate native LAN trust and per-project grants | Real Windows/Android Wi-Fi tests, revocation and AI-pairing isolation |
| 5 | Same-account Google OAuth and immutable Drive transport | Real cross-client appData access, secure native tokens, web expiry recovery |
| 6–8 | Hybrid receipts, conflict/recovery UX, fault/security/performance tests | No false Synced state, account isolation, real hardware soak and rollback |

Each slice gets its own reviewable PR. Where prerequisites are still open, use stacked PRs;
retarget dependent PRs after their bases merge. Do not represent Phase 0 as working synchronization.

## ADR 001 — Keep the local source of truth

Native `project.json`, `documents/*.json`, `assets/` remain authoritative. Add SQLite WAL state
for intents, revisions, outbox, inbox, aliases and per-transport receipts; do not convert project
files into an opaque database. Web moves from localStorage to IndexedDB with a transactional
copy/read-back migration that retains the legacy source until verified. AI sessions migrate
locally but remain excluded from sync by default.

Write intent before file mutation; atomically save file; commit queue and revision state; close
intent. Startup recovery compares hashes and completes or rolls back unresolved intents. A failed
transport never reverses a successful local save. Remote changes must be staged rather than
resetting an actively edited TipTap/canvas document.

## ADR 002 — Causal immutable revisions

Schema v1 uses UUID operation IDs, canonical project/entity IDs, origin device sequences, parent
revision hashes, payload hash and action. Client timestamps are display information. Multiple
unrelated heads remain a conflict; deletes remain tombstones. Duplicate operation IDs dedupe
across LAN and Drive; mismatched bytes for an existing operation ID are rejected. Receipts are
per destination, so LAN delivery alone cannot clear a Drive queue.

## ADR 003 — Separate trust domains

Existing AI pairing grants inference access only. Sync will have a separate protocol identity,
purpose-separated cryptography and explicit project read/write grants; discovered devices get no
project information until authorized. No sync network listener or OAuth flow is added in Phase 0.

## ADR 004 — Drive is an optional transport

Use the same user's appDataFolder with `drive.appdata`, distinct platform OAuth clients under one
application, and a real cross-client proof before transport implementation. Publish immutable
verified blobs before their batch manifests, retain cursors per account, and reconcile invalid
cursors without propagating cloud deletion. Keep browser access tokens in memory, native tokens
in secure stores. Google provisioning and live authorization require the user's account context.
Recheck official OAuth/Drive documentation at implementation time.

## ADR 005 — Merge preserves alternatives

Choose a canonical UUID and hierarchy once, never a permanent winning device. Name matching only
suggests candidates. Folder placement and content comparison are independent. A confirmed phone
root chapter may move under desktop Volume 1 without being considered a text conflict. Snapshot
both originals, stage a new project, retain aliases and journal decisions. Unknown-base divergent
chapters and graph snapshots require review; never concatenate or select by timestamp.

## ADR 006 — Recovery archives are separate from sync

Native Phase 0 recovery uses a versioned ZIP with exact bytes and SHA-256 digests for allowlisted
project data. This is corruption detection, not encryption or proof of a trusted sender. AI
conversations and generated exports belong in a manual recovery archive but do not enter sync by
default. Credentials, registry, pairing grants and app-level settings are outside the allowlist.

Restore activates a fresh local project identity in a new directory, leaving originals and their
registry entries intact. Only image attributes and known JSON asset fields are relocated; prose,
IDs and graph labels are not subject to global replacement. Restored AI provider configuration
is disconnected, while session files remain recoverable. The original archive retains metadata.

See [migration contract](MNEMOSYNC_MIGRATIONS.md), [threat model](MNEMOSYNC_THREAT_MODEL.md) and
[test matrix](MNEMOSYNC_TEST_MATRIX.md). The Phase 0 gate includes actual Android file-picker,
storage and recovery checks; passing Windows unit tests cannot satisfy it.
