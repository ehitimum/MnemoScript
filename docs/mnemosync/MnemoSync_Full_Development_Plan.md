# MnemoSync — Full Development Plan

**Project:** [MnemoScript](https://github.com/ehitimum/MnemoScript)  
**Feature:** Local-first, serverless multi-device project synchronization  
**Targets:** Windows desktop (Tauri 2), Android (Tauri mobile), web (React/Vite)  
**Planning baseline:** `feature/ai-assistant` at `0f15939e2f309d0021575e69ebe9075843b1a9f6` (2026-11-12)  
**Repository integration:** [PR #1](https://github.com/ehitimum/MnemoScript/pull/1) is **open**; `main` remains older. Start new work from the feature-branch HEAD after confirming it is current, or merge PR #1 first. Do not develop against old `main` in isolation.  
**Status:** Architectural plan; no code modifications or verified runtime integrations performed.  
**Companion handoff:** [`MEMORY.md`](./MEMORY.md)

---

## 0. Executive decision

Build **one local-first sync engine** with two *optional*, interoperable transports:

1. **MnemoLink (LAN)** — mutually authenticated, encrypted peer-to-peer sync between installed native apps on reachable local networks; automatically reconnect **after explicit first-time pairing** and project-level permission. No ongoing internet or hosted server. Existing AI pairing crypto/discovery concepts are reusable, but AI authorizations must **not** become project-sync authorizations by accident.
2. **MnemoDrive (Google Drive)** — each user grants MnemoScript a narrowly scoped Google Drive permission. Independent devices for that **same signed-in Google account** exchange immutable document revisions/change batches and content-addressed assets using the user's Drive quota. No MnemoScript sync server. The website uses this path first.
3. **Smart Project Merge** — a **prerequisite** for users who already have two independent copies of one novel. It chooses a canonical *project identity*, preferred *folder hierarchy*, and a safe mapping of items, **without choosing one whole device as the permanent winner**. Preserve every conflicting manuscript version.

All three work over the same transport-neutral immutable change model. A LAN-delivered change and a Drive-delivered copy must have the **same operation ID**, and applying it twice must be a no-op. The local store remains primary for ongoing editing; no cloud login is required to create or use local projects.

**Deliberate non-goals for initial release:** automatic live multi-user character-by-character collaboration, a central MnemoScript user account or backend, background Android sync guaranteed when the app is killed, universal zero-click browser discovery, automatic semantic manuscript merge, sharing projects between distinct Google accounts, and automatic syncing of OS credential stores.

### Product contract

- Save locally first. Users can write when offline. A failed sync never undoes a successful local save.
- Pairing automatically discovers and reconnects *trusted* devices, but a stranger on public Wi-Fi cannot read projects merely by being nearby.
- Each project controls LAN and Drive sync independently; local-only remains supported.
- Google Drive is an optional sync/backup provider, **not** a reliable transactional database. Use immutable events and verified blobs; do not update one shared ZIP or one mutable `project.json` from every device.
- `Sync complete` means all locally pending changes are durably published to each *enabled* destination, the client has applied known incoming changes, and no unresolved conflicts remain. LAN complete alone is **not** Google Drive complete.
- Sync cannot delete an original unmerged project during first-time project linking; merging must create backups and offer rollback.

---

## 1. Verified codebase baseline and impact

### 1.1 Repository audit (November 12, 2026)

- PR #1: **“MnemoScript v2 + AI assistant (2.0.0, 2.1.0, Codex)”**, open, branch `feature/ai-assistant` -> `main`.
- The active feature branch includes v2.0.0 persistence/shell improvements, v2.1.0 AI assistant, encrypted phone-to-PC AI pairing, and a **post-v2.1.0 Codex CLI integration** in `app/src-tauri/src/ai/codex.rs` (commit `0f15939e2f30`).
- [`app/src-tauri/src/project.rs`](https://github.com/ehitimum/MnemoScript/blob/0f15939e2f309d0021575e69ebe9075843b1a9f6/app/src-tauri/src/project.rs): local filesystem projects, `project.json` with metadata/folders/content-free document index, `documents/<id>.json` as authoritative document bodies; UUIDs and atomic writes; a registry maps UUID to local path. Native path can be user-selected. `Document` includes `id`, `title`, `content`, `updated_at`, `doc_type`, `order`, and `folder_id`.
- [`app/src/lib/api.ts`](https://github.com/ehitimum/MnemoScript/blob/0f15939e2f309d0021575e69ebe9075843b1a9f6/app/src/lib/api.ts): all Tauri IPC, plus a **web mock/fallback storing projects and AI sessions in browser `localStorage`**. This is not adequate as a production large-asset/offline sync store.
- [`app/src/lib/assets.ts`](https://github.com/ehitimum/MnemoScript/blob/0f15939e2f309d0021575e69ebe9075843b1a9f6/app/src/lib/assets.ts), `mapAssets.ts`: HTML image `src` and fantasy-map `assetPath` can hold **absolute OS paths**. Those are not cross-device portable and must be migrated.
- [`app/src-tauri/src/ai/pair_server.rs`](https://github.com/ehitimum/MnemoScript/blob/0f15939e2f309d0021575e69ebe9075843b1a9f6/app/src-tauri/src/ai/pair_server.rs), `pair_client.rs`, `pair_crypto.rs`: existing **AI-only** PC-side listener on TCP/UDP 47815, LAN broadcast discovery, 8-digit pairing code, SPAKE2, XChaCha20-Poly1305 envelopes, timestamp/replay checking, device revocation. Phone currently acts as a client of a PC, not as a symmetric full-project sync host. Pairing secrets are stored in local app files.
- [`app/src-tauri/src/ai/sessions.rs`](https://github.com/ehitimum/MnemoScript/blob/0f15939e2f309d0021575e69ebe9075843b1a9f6/app/src-tauri/src/ai/sessions.rs): AI conversations are `ai/sessions/<id>.json`. **Default: exclude from MVP sync**; design a later opt-in with session merging and privacy prompts.
- `app/src/App.tsx`: owns local document/project state, flushes editor/canvas pending changes on switch/background/close. A new sync adapter must not re-render/reset an actively edited TipTap/Konva/React Flow document, and must register changes only after durable local save.
- `app/src-tauri/src/lib.rs`: Tauri command surface plus asset raw-byte IPC. Add new sync commands without changing public behavior of existing project/AI commands.
- `docs/ARCHITECTURE.md`, `docs/DEVLOG.md`, `docs/IMPROVEMENT_PLAN.md`, `AGENTS.md`: update with new modules and test expectations.

### 1.2 Data and behavior inventory

| Data | Local source | Sync v1 | Special handling |
|---|---|---|---|
| Project metadata | `project.json` | Yes | Strip local `path`, avoid syncing device-specific AI default/credentials |
| Folder tree | `project.json` | Yes | Stable folder IDs, parent mapping, move/reorder/rename conflicts |
| Rich-text chapter | `documents/<id>.json` | Yes | TipTap HTML, preserve formatting, divergent versions |
| Mind map | document JSON | Yes | Preserve IDs and graph refs; conflicting graph snapshots reviewed |
| Fantasy map | document JSON | Yes | Images/heightmap/background asset dependencies |
| Assets | `assets/*` | Yes | Content-addressed, portable references, hash validation |
| AI chat sessions | `ai/sessions/*` | Later/opt-in | Personal writing context may be sensitive; append/same-session conflicts |
| Generated exports | `exports/*` | No by default | Regenerable and potentially large |
| Global registry | `registry.json` | Never | Local UUID -> filesystem path only |
| CLI/OAuth/API credentials | OS store/app-private | Never | Tokens never in project data or Drive files |
| Appearance and device UI prefs | device preferences | Not by default | Opt-in selective settings later |

---

## 2. The key case: desktop `Volume 1` vs mobile root chapters

### 2.1 Example

**Desktop** (proper structure): `My Novel / Volume 1 / Chapter 1, Chapter 2, Chapter 3, Mind Map`.  
**Android** (separately created): `My Novel / Chapter 1, Chapter 2, Chapter 3, Chapter 4, Mind Map` at root, with some chapters modified independently.

These may have different **project UUIDs, folder UUIDs, and document UUIDs**, even when they represent the same story. Matching by UUID alone will not work. Treat naming/content matches as **suggestions**, not proof.

### 2.2 First-time Smart Merge user flow

1. **Discover candidate duplicates:** while enabling sync, compare local vs peer/Drive project catalogues. Show potential same-novel groups based on normalized project name, document title/type overlap, hashes and optionally first-/last-paragraph similarity. Never auto-merge only because a project name matches.
2. **Select intentions:** `Keep separate projects` **or** `Link these copies as one project`.
3. **Choose canonical identity:** use desktop's project UUID **or** generate a new UUID. Both are fine, but choose once. This does **not** establish desktop as a permanent master. Store source-project alias mappings and ensure all subsequent replicas use the one canonical UUID.
4. **Choose preferred organization:** offer `Desktop layout`, `Mobile layout`, or `Custom`. Default this scenario to `Desktop layout` because the writer wants the `Volume 1` hierarchy.
5. **Match folders independently of documents:** map `Desktop Volume 1` to a canonical folder ID. A root-level Android chapter that matches a chapter in `Volume 1` maps to the **canonical chapter ID** *and* **canonical `folderId`**; its missing Android folder is not a content conflict.
6. **Match documents:** exact logical UUID (same lineage) -> exact hash -> normalized title+type+substantial content similarity -> manual confirmation. Show confidence; never silently treat two different stories called `Chapter 1` as identical.
7. **Classify each document:** identical, only on one side, metadata-only difference (e.g., root vs folder), one-sided edit with a proven common base, or concurrent/unknown-base content conflict.
8. **Preview:** a tree preview shows where all imported chapters, maps, assets and folders will live. Separate *placement* decisions from *content* decisions. Mobile-only `Chapter 4` is suggested under `Volume 1`, but confirmation is required for unrelated root items.
9. **Review conflicts:** for unknown ancestry or divergent TipTap HTML, show side-by-side rendered previews and word/paragraph diffs; choose `Keep desktop`, `Keep mobile`, `Keep both`, or user-prepared manual merge. Always retain the rejected alternative in recoverable history/snapshot. Never concatenate whole chapters automatically after manual copy/paste.
10. **Backup both projects:** create immutable snapshots/exports with checksums before mutation (e.g. desktop `~/.mnemoscript/backups/<merge-id>/...`, Android app-private backup; Drive staged backups if working remotely).
11. **Dry-run & commit:** validate IDs, folder links, asset dependencies, document types, unique orders and storage capacity. Apply to a **new staging copy**, then atomically update local registry / activate it. Journal each step so interruption resumes or rolls back safely.
12. **Publish mapping and canonical snapshot:** send a signed/authenticated `project.link` record with mapping tables, then the merged snapshot. Other replicas import canonical IDs without destructive overwrite. Existing source folders remain available until the writer explicitly removes them after confirming a successful sync on every target.

### 2.3 Example match table

| Android item | Desktop item | Suggested action |
|---|---|---|
| Root/Chapter 1, same text | Volume 1/Chapter 1 | Deduplicate; map Android doc ID to canonical ID |
| Root/Chapter 2, different folder only | Volume 1/Chapter 2 | Preserve text; use `Volume 1` placement |
| Root/Chapter 3, edited text | Volume 1/Chapter 3 | Conflict preview; do **not** silently select the newer file |
| Root/Chapter 4 (mobile-only) | No match | Import under Volume 1 after confirmation |
| Root/Mind Map, modified graph | Volume 1/Mind Map | Preserve both versions; graph-aware/manual choice |

**Crucial principle:** “Choose the primary” means choosing **initial identity and folder layout**, *not* setting a perpetual authoritative device. After linking, either device may originate edits; conflicts resolve per entity.

### 2.4 ID aliases and migration journal

Persist `sourceProjectId -> canonicalProjectId`, `(sourceProjectId, sourceDocumentId) -> canonicalDocumentId`, and analogous folder IDs, with a `mergeId`, source fingerprints, backup locations and commit state. All ID remapping must rewrite safe internal references (e.g. `folderId`, references between linked nodes/docs) where supported. Never rewrite arbitrary prose/HTML strings by global find-and-replace. Preserve old source ID/history for import idempotency.

Conflicts in *folder layout* can be resolved separately: if one device moves Chapter 2 into Volume 1 while the other edits Chapter 2's text, both changes may be applied because they address different fields. For concurrent differing moves, ask the user to select the destination.

---

## 3. Shared sync data model: no server-side authority

A central server is unavailable, so there cannot be a guaranteed single integer `revision` assigned by a server. Use **revision ancestry** with content-addressed versions, globally unique operations, per-device ordered batches, and deterministic/idempotent replay. Client wall-clock time is for display only, never a sole conflict tiebreaker.

### 3.1 Stable entities

- `projectId`: canonical UUID once linked.
- `deviceId`: random per installed device/browser profile; regenerated if local identity wiped.
- `folderId`: UUID stable across devices; parentFolderId nullable.
- `documentId`: UUID stable across devices; type `text | mindmap | fantasymap`.
- `assetId`: SHA-256 hash + MIME/extension metadata, or random ID bound to hash, with immutable bytes.
- `sessionId`: unique AI session ID if later synced.
- `operationId`: UUIDv7 or random UUID plus device sequence; never reuse.
- `revisionId`: hash of canonicalized entity snapshot and causal parent revision IDs (avoid serialization-dependent mismatches).

### 3.2 Proposed typed records

```ts
type EntityKind = 'project' | 'folder' | 'document' | 'asset' | 'ai-session';
type MutationKind = 'create' | 'update' | 'move' | 'reorder' | 'delete' | 'link';

interface SyncOperation {
  schemaVersion: 1;
  operationId: string;
  canonicalProjectId: string;
  originDeviceId: string;
  originSequence: number;
  entity: { kind: EntityKind; id: string };
  action: MutationKind;
  parentRevisionIds: string[];  // causal base(s), NOT timestamps
  newRevisionId: string;
  payloadHash?: string;           // content-addressed immutable blob
  metadataPatch?: Record<string, unknown>;
  createdAtClient: string;        // display/debug only
}

interface SyncBatch {
  schemaVersion: 1;
  batchId: string;
  projectId: string;
  deviceId: string;
  fromSequence: number;
  toSequence: number;
  operations: SyncOperation[];
  checksum: string;
}

interface LocalSyncState {
  projectId: string;
  enabledTransports: ('lan' | 'drive')[];
  outbox: SyncBatch[];            // DURABLE, not React-only state
  appliedOperationIds: string[];  // store compactly in DB
  knownRevisionHeads: Record<string, string[]>;
  perPeerCursors: Record<string, string>;
  pendingConflicts: string[];
}
```

For the local backend, store index/outbox/heads in **SQLite with WAL and transactions** (Rust `rusqlite`/`sqlx` evaluation) while **retaining existing document JSON files** for compatibility. Browser: IndexedDB (Dexie or native wrapper) with transactional queue/state. Where file save and SQLite transaction cannot be atomic together, use a **write-ahead intent** plus startup reconciliation/content-hash scan: save file safely; queue retry; confirm both are consistent. Never mark a change as published before the corresponding payload has been verified at the destination.

### 3.3 Ordering and causal merge

- Same `operationId` and same payload: ignore duplicates regardless of transport.
- Same entity, new revision whose parents include current head: fast-forward.
- Different entities, independent edits: apply both.
- Same entity, parallel revisions with no known ancestry: leave multiple heads and present conflict.
- Metadata field-level merging only for explicitly commutative edits; `folderId` and `order` need deterministic behavior and conflict detection.
- Deletes use tombstones; a returning offline device must **not** resurrect deleted documents automatically. Concurrent edit vs delete becomes recoverable conflict.
- Keep snapshots/revisions for a defined retention period, separate from user-visible “Trash.” Avoid automatic garbage collection until all registered devices' state/retention rules permit it; offline devices could return months later.
- Use per-device unique operations and batch sequence continuity to detect gaps/partial transfer. Do not assume Google Drive listing order or LAN delivery is causal order.

### 3.4 Portable asset references

Replace absolute paths in persisted content with a stable asset URI, e.g.:

```html
<img src="mnemo-asset://sha256-..." alt="Map illustration" />
```

and map JSON:

```json
{"assetId":"sha256-...","libId":null}
```

Provide one resolver per storage backend: native Tauri asset-protocol URL; web `Blob`/object URL with lifecycle cleanup. Migrate old absolute paths only when bytes are readable; missing assets produce a report + placeholder, not a permanently broken rewritten path. Asset first, referencing revision second; check size/MIME/hash on download and enforce size limits. Same hash => upload once. Do not sync binary data as base64 in document JSON.

---

## 4. MnemoLink: encrypted local pairing and LAN transport

### 4.1 Reuse versus isolate

Reuse the conceptual infrastructure (`pair_crypto.rs` SPAKE2, XChaCha20-Poly1305, replay protection; broadcast discovery or optionally mDNS). **Do not extend `ai/pair_server.rs` with project-file permissions or reuse `ai/` trust grants without user consent**. Prefer `sync/lan/{discovery,pairing,protocol,server,client}.rs`, separate protocol name, derived or independent keys, separate port/service identity, protocol version, key rotation/revocation. AI device trust and Sync project trust are distinct capabilities.

### 4.2 Device roles

- Desktop: accepts inbound sessions while MnemoScript open; also dials peers.
- Android: can dial desktop reliably while foregrounded; optional foreground-only inbound listener. Background execution depends on Android lifecycle, network permissions, OS restrictions and user expectations.
- Multiple devices: no single permanent master. A peer advertises project IDs only after authentication/authorization; no manuscript metadata in pre-auth discovery beacons.
- Browser: **not v1 auto-discovery**; browsers cannot use arbitrary UDP discovery. Later use a user-initiated known-address/QR local WebSocket/HTTP channel if browser security policy permits; Drive is v1 web path.

### 4.3 Discovery, authentication and authorization

1. Device advertises random/opaque ID and service/protocol version on LAN, not chapter titles or project names.
2. Known devices reconnect automatically and mutually authenticate their saved identity.
3. New device: explicit user-initiated pairing, 8-digit code/QR and SPAKE2 (or equivalent vetted PAKE), limited attempts, short validity, short confirmation of device fingerprint.
4. After device trust: show **project access grants** (`read/write` per project, optionally read-only); default *no access*. Confirm both sides for each project link. Revocation takes effect on next request; actively terminate live sessions.
5. Secure session encryption/integrity, purpose- and direction-separated AAD, fresh nonces, replay protection, per-request IDs; limit peer payload sizes/rates and bound concurrent sessions.
6. Exchange protocol/schema capabilities; reject unknown mandatory schema, downgrade to safe read-only with upgrade message.
7. Exchange project catalogs/heads, missing operation IDs/hashes and assets; transfer in bounded chunks; hash-verify and acknowledge; checkpoint cursors. Resume interrupted sessions.
8. When offline or peer gone, retain durable outbox; retry when peer reappears/app resumes. Do not block editor saves.

### 4.4 LAN wire protocol (illustrative)

`POST /sync/v1/hello`, `/pair`, `/auth`, `/projects`, `/summary`, `/batches/pull`, `/batches/push`, `/blobs/get`, `/blobs/put`, `/ack`, `/revoke`. All project-affecting methods require cryptographic authentication + scoped authorization. Prefer a well-tested framed binary protocol or HTTP with robust bounds rather than expanding minimal hand-rolled HTTP parser for uploads.

Propose manifest exchange and diff by hashes: send small summaries first, transfer missing blobs only, fetch incremental batches. TLS is optional **only if** application-layer encryption thoroughly protects confidentiality and integrity for **every** message and binary chunk; explicit domain separation is mandatory. Avoid raw plaintext project content over LAN.

### 4.5 Failure/corner cases

- Wi-Fi client isolation, firewalls, VPNs, subnet discovery differences, IPv6, Windows network profile, Android multicast/broadcast restrictions, local IP changes, lost UDP replies, two peers simultaneously initiating, duplicate delivery, partial blob uploads, wrong device clock and revocation during transfer.
- Browser bridge requires HTTPS hosting, permission/CORS, and origin allowlist, with no arbitrary websites allowed to call desktop. Cross-browser universal support is **not guaranteed**.
- Existing AI pairing uses UDP discovery and TCP port 47815; avoid port collision and segregate state. After product validation, a shared discovery registry can advertise **distinct service capabilities**, not shared authorization.

---

## 5. MnemoDrive: user's own Google Drive as rendezvous + storage

### 5.1 Storage choice and identity

**Primary option:** hidden `appDataFolder`, OAuth scope `https://www.googleapis.com/auth/drive.appdata`. This is a per-user, per-application hidden area and *does not appear in the regular Drive UI*. Files in this area are not shareable and cannot be moved/trash-managed like regular files; user account storage limits apply. The actual file namespace is flat: represent logical paths in filenames/properties and client manifests, not with real directories.

**Secondary option, later:** visible `MnemoScript Backups` folder under My Drive, with `drive.file` and user-created/app-created files. Offer manual ZIP/JSON export; do not silently move live appData into a Drive folder (different spaces). Clearly distinguish **Sync** vs **Backup/Export**. Never request broad full-Drive scope for convenience.

An installed app, Android app and website must use properly configured OAuth client identities within the same MnemoScript Google Cloud application/consent configuration; **test cross-platform access to the same `appDataFolder` account in a real environment before investing in sync logic**. A Google account connected on one device does not automatically authenticate another device; each must explicitly authorize, and must match the intended Google account.

### 5.2 OAuth implementation

- **Windows:** installed-app OAuth authorization-code + PKCE/system browser with localhost loopback redirect; store refresh material securely in Windows Credential Manager, scoped to MnemoScript, never in the project folder.
- **Android:** platform-supported native Google authorization via Android integration (Google Identity Services / current recommended authorization API) with correct package name/signing fingerprint and Tauri plugin boundary; secure refresh/token material using Android Keystore-backed encryption where supported. Do not put refresh tokens in regular JSON or JS localStorage.
- **Web:** Google Identity Services browser token flow with user gesture, in-memory access token and clear expiry/reconnect UI. A browser-only app **cannot promise indefinite unattended auth refresh without a backend**. Never embed an OAuth client secret or persist a refresh token in accessible localStorage.
- **Security:** identify account by Google stable subject ID (`sub`) if requested appropriately (e.g. OpenID Connect); compare account identity when linking devices. App data remains scoped to the signed-in account; no server-side user database.

### 5.3 Drive storage layout: immutable, retryable

With no transaction/CAS on a shared project file, never let two devices overwrite a mutable `project.json` or `novel.zip`. Instead:

```text
appDataFolder (flat; conceptual names)
  mnemo-v1/catalog/<catalog-snapshot-id>        # optional acceleration
  mnemo-v1/p/<project-id>/ops/<device-id>/<seq>-<batch-id>.json
  mnemo-v1/p/<project-id>/blobs/<sha256>
  mnemo-v1/p/<project-id>/snapshots/<snapshot-id>.json
  mnemo-v1/p/<project-id>/merge/<merge-id>.json
```

These are **file naming conventions**, not actual nested Drive folders. Each immutable batch references only already uploaded and hash-verified payloads. Batch publication is the commit marker. Identical retries can create duplicate Drive file entries, so content IDs/operation IDs are part of metadata and the client must reconcile duplicates idempotently. Query efficiently via `files.list(spaces=appDataFolder, ...)` initially, then persist `changes.getStartPageToken`/`changes.list(spaces=appDataFolder)` cursors. `changes.list` describes *file* updates, not application-level revision ordering; the sync engine still reads operation manifests and resolves ancestry. On an invalid/unusable cursor, perform full reconciliation, not blind overwrite.

**Traffic optimization:** debounce editor saves to a bounded local queue, coalesce untransmitted revisions of the same entity *only if causal history and conflict detection remain valid*, write compact batches at reasonable time/size thresholds, gzip when appropriate, hash dedupe assets, and checkpoint/snapshot to avoid unbounded replay. Do not create one Drive file per keystroke. Preserve conflict-producing revisions and current heads.

### 5.4 Drive lifecycle

1. User turns on Drive sync, signs into Google, and selects projects to sync.
2. First device uploads immutable blobs and a first project snapshot/batch; verify publication.
3. Next device discovers remote projects; offers `Download new project`, `Link to existing local project`, or `Keep separate`. If it already contains the same novel, invoke Smart Merge **before adopting a canonical ID**.
4. On local save: persist locally -> queue operation -> upload dependencies -> publish immutable batch -> mark Drive delivered.
5. Pull: read change feed -> discover manifests -> fetch missing payloads -> validate checksums/schema -> apply safely -> checkpoint.
6. After LAN delivery, still upload to Drive if enabled; Drive receives the identical operation IDs.
7. On 401/expiry: pause Drive only, keep local/LAN saves, request reconnection without discarding outbox.
8. On 403/429/quota: exponential backoff + jitter, show `Waiting for Drive`; do not busy-loop or erase changes.
9. On 404/removed app data: freeze deletion handling, offer restore from local copies/backup; do not propagate a potentially destructive cloud reset into every device.
10. On account switch: show explicit warning; keep separate namespaces/cursors per Google account; never upload account A's projects to B without explicit consent.

### 5.5 Google API cost/quotas

Standard Drive API usage is currently described by Google as free within standard quotas; billing for above-threshold use is **planned later in 2026**. Drive API quotas use **quota units** (for example, list methods are relatively expensive); the app creator's Cloud project may be affected even though data belongs to users. Monitor Google Cloud metrics, set safety limits/alerts and conservative poll intervals, and avoid frequently calling list endpoints for each chapter. A minimal hosting bill does **not** imply unlimited free API traffic. See official [Drive usage limits](https://developers.google.com/workspace/drive/api/guides/limits).

---

## 6. One sync engine, two transports

### 6.1 Interface and transport-independent semantics

```ts
interface SyncTransport {
  id: 'lan' | 'drive';
  connect(context: SyncAuthContext): Promise<void>;
  discoverProjects(): Promise<RemoteProjectSummary[]>;
  exchangeHeads(projectId: string, known: KnownHeads): Promise<RemoteHeads>;
  pullBatches(projectId: string, cursor?: string): Promise<PullPage>;
  pushBatch(projectId: string, batch: SyncBatch): Promise<PushReceipt>;
  hasBlob(projectId: string, hash: string): Promise<boolean>;
  downloadBlob(projectId: string, hash: string): Promise<Uint8Array>;
  uploadBlob(projectId: string, hash: string, bytes: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}
```

`PushReceipt` means **that destination acknowledged verified publication**; per-transport receipts are tracked separately. The merge/reconciliation engine must not contain transport-specific `if (drive)...` decisions. Drive availability and LAN presence can vary independently. A shared local operation outbox fans out to both enabled destinations. Incoming operations are deduplicated by `operationId` and verified payload hash.

### 6.2 State machine

`local-only`, `not-configured`, `needs-auth`, `discovering`, `syncing`, `up-to-date`, `offline-queued`, `conflict`, `error/backoff`, `needs-upgrade`. Show LAN and Drive status separately when both are enabled. Show pending operations and last successful exchange; never show `Synced` while content remains unsent to a selected destination. For no-op offline sessions, the local app remains usable.

### 6.3 Concurrency/lifecycle integration

- A document being edited may be updated remotely. Do not replace the TipTap live model mid-composition without user permission; stage incoming state, show `Remote update available` or apply safely when idle with preserved selection/undo.
- AI Auto mode modifies manuscripts through frontend tools; it must generate the same durable sync events and respect conflict/approval states. AI tools must not receive Google OAuth credentials or LAN device keys.
- Persist a per-document local dirty flag, document revision head(s), and per-transport delivery; use checksums to reconcile project JSON after abnormal shutdown.
- `project.json` metadata and `documents/*` snapshots are not a cross-file transaction. Staging/journal/replay guarantees are required around operations affecting multiple entities (e.g., moving folder+docs, initial merge, restoring backup).
- Clear revision histories and merge mappings never means silently deleting content: snapshot/recoverability first.

---

## 7. Conflict resolution policy

| Conflict | Initial policy | Future improvement |
|---|---|---|
| Same chapter edited on two devices | Preserve 2 heads; side-by-side TipTap preview/diff; writer chooses or manually merges | Proven-ancestor 3-way merge, eventually Yjs/CRDT |
| Same title but different `documentId` | Suggest duplicate match only; ask writer | Improved semantic suggestions, never auto-destructive |
| Desktop Volume 1 vs mobile root | Desktop canonical hierarchy; map matching mobile docs to `Volume 1` | Flexible folder mapping rules |
| Folder renamed differently | Preserve candidate names + prompt | Conflict-aware field merge |
| Chapter moved while text changed elsewhere | Merge move and text when independent fields/causal ancestry | Fine-grained operations |
| Different moves/reorders | Choose order/location, preserve other metadata | Fractional order keys/sequence CRDT later |
| Deleted on A, edited on B | Recoverable delete-vs-edit conflict | Version history view |
| Fantasy map/mind map concurrent edits | Keep alternative snapshots, ask; do not naïvely merge graph JSON | Domain-aware graph operations |
| Image missing locally | Download by hash; placeholder until verified | Smart prefetch |
| AI chat on two devices | Keep local by default | Opt-in session model with record-level merge |

TipTap HTML diffing is tricky: canonical normalization must preserve marks, nodes, image refs, task lists and formatting. Use a parser-aware comparison where practical; a pure raw HTML diff is insufficient for reliable auto-merge. Without a common base, do not silently join user-edited paragraphs that may have been copy-pasted between devices.

---

## 8. Full phased development plan

Each phase has tangible code artifacts and an exit gate. Durations are **not** commitments; prioritize completion of reliability gates over dates. Release labels are proposals.

### Phase 0 — Branch, requirements, threat model, backups

**Build:**
- Confirm feature branch HEAD / PR #1 status; optionally merge PR #1 into `main`, then branch `feature/mnemosync` from integrated HEAD. Do not copy modules from old main.
- Add `docs/MNEMOSYNC_ARCHITECTURE.md`, `docs/MNEMOSYNC_THREAT_MODEL.md`, ADRs: storage, revision ancestry, Google scope, LAN auth, merge policy.
- Record test corpus: desktop Volume 1 + mobile root, divergent chapters, images, fantasy maps, AI sessions, cross-platform custom project paths.
- Define schema version, permissions matrix, retention, max sizes, recovery UX, and E2EE stance (Drive traffic is TLS-protected, not automatically end-to-end encrypted).
- Implement full project ZIP export/checksum/restore independent of sync.

**Exit gate:** two existing v2.1.0 projects can be exported/restored losslessly on desktop and Android; current tests still pass; baseline documented.

### Phase 1 — Local persistence foundation and asset portability

**Build:**
- Native `sync/` SQLite index/queue/revision tables with WAL and recovery journal; retain JSON project files and their public APIs.
- IndexedDB web production storage (`ProjectStore` abstraction), migration from `mnemoscript:projects` localStorage and `mnemoscript:ai-sessions:*`, no accidental wipe on interruption.
- Add asset IDs/content hashes; migrate TipTap `<img src>` and map `assetPath` to portable references via import mapping; keep legacy reads compatible.
- Implement `save => durable queue` intent and crash recovery; serializable project snapshots, hash validation, schema tests; protect against path traversal/symlink escapes.
- Separate local UI settings and AI secret fields from syncable project metadata.

**Exit gate:** old projects open unchanged; images display in all three platforms with imported test assets; huge web project avoids localStorage limits; forced-crash tests find no unrecorded committed edits.

### Phase 2 — Smart Project Merge (required before linking old copies)

**Build:**
- `MergeCandidateScanner`, `DocumentMatcher`, `FolderMapper`, `MergePreview`, `MergeJournal`, `MergeExecutor`.
- Source/canonical ID aliases, optional canonical project ID selection, dry-run detection, non-destructive staging copy, snapshots of both originals.
- Root-vs-Volume-1 placement mapping, exact duplicate detection, title-only suggestions, content hash/similarity candidates, safe manual review.
- Keep both conflicting chapters as explicit choices; rich text comparison and diff preview; map/mind map snapshot previews.
- Import canonical result into each target without deleting source; cancellation/rollback/resume; store merge decisions for subsequent imports.

**Exit gate:** desktop `Volume 1` + mobile root yields canonical `Volume 1` with imported mobile-only Chapter 4; all text revisions and image/map refs recoverable; interruption during merge cannot destroy either source.

### Phase 3 — Shared core sync engine

**Build:**
- Model/codec (`SyncOperation`, `SyncBatch`, `KnownHeads`), immutable revision DAG per entity, outbox, apply engine, field-level metadata merge, tombstones and bounded history.
- Transactional/durable enqueue, idempotent replay, causal version verification, safe checkout of new revisions, multi-transport receipts.
- `SyncTransport` interface + in-memory deterministic transport for tests.
- Service hooks after save, project/folder change, image import, AI write tools, app launch/resume and network regain.
- Conflict work queue/UI model; separate per-project and per-device cursors.

**Exit gate:** deterministic two- and three-replica simulation across arbitrarily reordered/duplicated/dropped messages converges for nonconflicting changes, never silently loses concurrent edits, and preserves tombstones after offline reconnect.

### Phase 4 — LAN pairing and native sync (MnemoLink)

**Build:**
- New sync-specific discovery, listener, authenticated session, project grant and revoked-device table. Consider mDNS plus existing UDP discovery fallback.
- Extract **only safe crypto helpers** from `ai/pair_crypto.rs`; use new purpose-specific keys/capabilities. Strict separation of AI inference and sync permissions.
- Desktop PC as responsive listener + Android foreground client; optionally Android foreground listener once stable.
- Wire endpoints for summaries, missing ops/blobs, chunked encrypted transfer, acknowledgments, cancellation, retries.
- Trust management UI: nearby discovery, pair QR/short code, project sharing grants, revoke/rename.
- Network firewall/platform capability tests; no inbound connectivity requirement for Android v1.

**Exit gate:** two real devices pair once, reconnect on the same Wi-Fi, sync a new/moved/edited/deleted document and an imported image; untrusted LAN devices cannot list projects; offline interrupted transfer resumes; AI pairing still works.

### Phase 5 — Google OAuth + Drive transport (MnemoDrive)

**Build:**
- Google Cloud project, consent, scope `drive.appdata`, desktop/Android/web OAuth clients, app domain verification and privacy policy as required by Google; external public-app verification testing.
- Secure native token persistence (Windows credential store, Android secure storage), ephemeral web access token/reauthorization UI.
- Cross-platform proof: all three clients read/write the **same** appData account namespace; explicitly test separate OAuth client IDs.
- `DriveTransport` with flat logical naming, appProperties/manifest indexes, immutable batches, blobs, initial list and changes cursor, resumable upload for larger assets, retry/backoff and dedupe.
- Account mismatch and Drive removal handling. Drive usage telemetry with local/privacy-safe counters, upload batching and user-controllable network policy.

**Exit gate:** independently launched desktop, Android and web load the same remote project (after the same Google account grants permission), offline edits safely catch up; duplicate retries do not duplicate chapters; expired web auth gives an explicit prompt rather than losing queued changes.

### Phase 6 — Hybrid fan-out and reconciliation

**Build:**
- A transport coordinator: publish once per enabled transport, track independent delivery receipts, pull from both, dedupe global ops, merge revision heads consistently.
- Auto-prefer LAN for available peer transfers while Drive remains asynchronously updated when enabled; force Drive-only if LAN not reachable; respect per-project `local | LAN | Drive | hybrid` setting.
- Device catalog/account mapping, source-project alias handling, history compaction safety, multi-device conflicts.
- Reconcile when switching modes (LAN-only -> hybrid, Drive-only -> hybrid, project linked with pre-existing Drive data).

**Exit gate:** desktop <-> Android LAN sync then web through Drive sees precisely one copy of each document; 3-device concurrent operations converge without duplicates; account switch does not mix data.

### Phase 7 — UX, recovery, and browser LAN feasibility

**Build:**
- Welcome/project list `Local / Pending / Synced / Conflict`, Sync Settings and per-project destinations, pending-count and last-sync timestamps.
- Smart Merge Wizard screenshots/previews and confirmations; `Recover previous version`, `Keep both`, `Fix broken asset` and `Restore backup` actions.
- On web, optional Chromium-oriented local desktop connection proof of concept: known host/QR + user gesture + HTTPS origin + CORS + Local Network Access permissions; test mixed-content/WebSocket behavior on supported browser versions. Ship browser LAN only if threat model and compatibility tests pass; otherwise explicitly label experimental and keep Drive default.
- User-facing explanations for same-account, no internet, auth expiry, quota, local network isolation and Android background constraints.

**Exit gate:** a writer can link two existing projects safely without developer tools, can recover any conflict, and can tell what remains pending on each transport.

### Phase 8 — Security, fault testing, performance and rollout

**Build:**
- Threat tests: unauthorized peer, revoked device, replay, malformed payload, path traversal, oversized assets/ZIP bombs, malicious HTML/XSS, tokens in logs, account switch, LAN network-origin abuse.
- Fault injection: crash after file write/before queue, crash after blob upload/before batch, 409-style concurrent heads, Drive 401/403/429/5xx, power/network loss, disk full, Android killed, stale Drive cursor, deleted cloud app data.
- Multi-replica randomized property tests (event reorder/duplication, arbitrary offline durations), real hardware soak tests, upgrade/downgrade migration tests; keep existing Claude/Codex/AI tests passing.
- Incremental quota dashboard and diagnostic logs with content redaction; private beta, canary release, backup-required first sync, explicit rollback instructions.

**Exit gate:** no known data-loss path in test corpus, safe disable/re-enable and restore, no cross-project data disclosure, reliability metrics acceptable in beta.

### Phase 9 — Post-MVP optional evolution

- Opt-in AI session synchronization (without syncing API secrets, login sessions or other tokens).
- Better metadata/graph conflict operations, then safe three-way text merge when bases are known; evaluate Yjs/TipTap collaboration for actual simultaneous editing only after baseline sync is stable.
- Efficient snapshot pruning/garbage collection with durable per-device acknowledgments and conservative offline retention.
- Visible Google Drive backup/export provider, recovery codes/export archive; potential user-controlled end-to-end encrypted Drive sync as an explicitly separate project.
- Better cross-browser LAN, optional Apple/iOS client, peer-to-peer relay through user-owned infrastructure if demand exists.

### Proposed release grouping

| Proposed version | Scope |
|---|---|
| `2.2.0` beta | Phases 0–4: safe local persistence, Smart Merge, native LAN sync |
| `2.2.x` | Phase 5: Google Drive provider and web sync, only after OAuth validation |
| `2.3.0` | Phase 6 hybrid experience + Phase 7 UX + Phase 8 hardened public release |
| Later | Phase 9 (collaboration, session sync, optional E2EE) |

**Alternative:** ship all Phases 0–8 as a single `2.2.0` if one-version delivery is a product constraint. Do not bypass security/data-loss gates to meet a release number.

---

## 9. Suggested concrete code layout

```text
app/src/lib/sync/
  types.ts               # cross-platform protocol/schema
  engine.ts              # causal reconciliation, apply decisions
  merge/
    candidates.ts
    matcher.ts
    folderMapping.ts
    preview.ts
    decisions.ts
  transports/
    SyncTransport.ts
    DriveTransport.ts
    LanClient.ts
  storage/
    WebProjectStore.ts   # IndexedDB
    NativeProjectStore.ts
  assets.ts              # portable URI resolver
  useSyncStatus.ts

app/src/components/sync/
  SyncSettings.tsx
  SyncStatus.tsx
  PairDeviceWizard.tsx
  MergeProjectsWizard.tsx
  ConflictReview.tsx
  RecoveryPanel.tsx

app/src-tauri/src/sync/
  mod.rs
  commands.rs
  database.rs            # SQLite queue/revisions/index
  journal.rs
  manifest.rs
  lan/
    discovery.rs
    pairing.rs
    server.rs
    client.rs
    crypto.rs
  drive/
    auth.rs
    transport.rs

docs/
  MNEMOSYNC_ARCHITECTURE.md
  MNEMOSYNC_THREAT_MODEL.md
  MNEMOSYNC_TEST_MATRIX.md
  MNEMOSYNC_MIGRATIONS.md
```

Use `src/lib/api.ts` as the public frontend command boundary and register new commands in `src-tauri/src/lib.rs`. Avoid replacing native project files wholesale with SQLite; SQLite is for **sync state and transactions**, while existing project JSON stays readable and backup-friendly.

---

## 10. Test plan / acceptance matrix

| Test scenario | Expected outcome |
|---|---|
| Desktop Volume 1 + Android root; both created independently | Wizard discovers potential duplicate; canonical Volume 1; no lost docs |
| Chapter 3 edited both sides with no shared base | Two versions preserved; manual conflict choice |
| Chapter 4 exists on phone only | Imported into selected Volume 1 folder |
| Identical chapter with different IDs | One logical document after confirmed mapping; alias retained |
| Same title, unrelated content | Not auto-deduplicated |
| Different folder trees | Preferred hierarchy adopted, content independent |
| Same chapter moved on desktop, edited on phone | Merge placement and text without losing either |
| Delete while remote device offline | Tombstone survives; offline stale replica cannot resurrect by default |
| Device paired on public LAN | Unauthorized device sees no project metadata |
| Same op arrives via LAN and Drive | Applied once |
| Drive enabled, PC off, Android changes | Web downloads once signed into same Drive account |
| Drive auth expires on web | Re-auth UI; queued changes remain local |
| Google account A vs B | Separate namespaces; explicit warning, no cross-upload |
| App killed during save/queue | Recovery journal reconstructs missing outbox entry |
| App killed during merge | Staging resumes or rolls back; originals intact |
| Partial image transfer | Hash mismatch prevents reference from being published |
| AI Auto edit, undo, and remote conflict | Both edits captured as local changes; remote state preserved |
| Mind/fantasy map with images | Graph remains valid; all assets load on each platform |
| Android background suspension | Pending local changes preserved until next successful foreground sync |
| Browser unsupported local network API | Drive works; LAN feature gracefully unavailable |
| Drive app data deleted | Local copies stay; app asks before reinitializing remote namespace |
| Existing imported custom-path desktop project | Local registry path retained; remote snapshots path-free |

Testing commands consistent with branch `AGENTS.md`:

```bash
cd app
npm install --legacy-peer-deps
npm run check
cd src-tauri
cargo check
cargo test
cargo clippy -- -D warnings
```

Add targeted Vitest property/regression tests for merge and sync; Rust tests for codec/crypto/peer protocol; actual Windows + Android Wi-Fi tests; browser compatibility matrix and Google OAuth test accounts. Never claim real hardware behavior is verified based only on loopback tests.

---

## 11. Cost controls and policy

- No persistent MnemoScript-managed compute required. Static web hosting may use a free tier but is not a guarantee of zero cost.
- Drive files occupy **the user's Drive quota**. All ordinary app-owned data stays in their account; do not introduce a service account as the universal file owner.
- API traffic uses the MnemoScript Google Cloud project quota. Request units for list calls are costly; prefer a single change feed cursor per account/space and sparse polling. Follow Google quota/backoff guidance; provide a local setting such as `Sync on Wi-Fi only` and explicit `Sync now`.
- Batch small edits rather than one remote file per keystroke; uploads only verified changed blobs; compress payloads when beneficial; set client file-count, bandwidth, and retention budgets; do not silently prune unacknowledged history.
- Google OAuth verification (privacy policy, verification domains, test users, screenshots, potential security assessment depending on scopes) can create administrative work even without server costs.
- Default project content cloud sync is **not end-to-end encrypted** merely because OAuth and HTTPS are used. Explain this plainly to writers. A future E2EE setting requires cross-device key recovery, conflict-aware encryption, and robust key-loss handling.

---

## 12. Open decisions to record as ADRs (defaults selected for planning)

| Question | Proposed decision |
|---|---|
| Must users sign in to write? | **No**, all projects start local-first |
| Which Drive area? | **appDataFolder** for sync; visible folder only for explicit backup/export |
| Is Drive always the master? | **No**, it is one storage/transport; revision ancestry drives merge |
| Can users pair automatically on Wi-Fi? | Auto-**discover**, one-time explicit **trust** and per-project access, then auto-reconnect |
| Does web need LAN at launch? | **No**, Drive first; optional browser LAN experimental later |
| Which device is primary forever? | **Neither**, canonical ID/layout chosen once; thereafter multi-writer |
| How to reconcile Volume 1 vs root? | Match chapters separately from folder placement; default desktop hierarchy |
| What if content conflicts? | Preserve both, show preview; never last-write-wins |
| Do AI sessions sync immediately? | **No**, opt-in follow-on; secrets never sync |
| Does sync automatically erase originals? | **No**, staging/backup first and explicit later cleanup |
| Do native project files switch to DB only? | **No**, keep JSON as data source; add separate transactional sync state |
| Is Drive also backup? | Sync redundancy **is not** sufficient backup; separate export/restore path |

---

## 13. Source references

**Repository:**
- [PR #1 — merged work pending](https://github.com/ehitimum/MnemoScript/pull/1)
- [Feature branch](https://github.com/ehitimum/MnemoScript/tree/feature/ai-assistant)
- [Project persistence](https://github.com/ehitimum/MnemoScript/blob/feature/ai-assistant/app/src-tauri/src/project.rs)
- [AI pairing server](https://github.com/ehitimum/MnemoScript/blob/feature/ai-assistant/app/src-tauri/src/ai/pair_server.rs)
- [AI pairing crypto](https://github.com/ehitimum/MnemoScript/blob/feature/ai-assistant/app/src-tauri/src/ai/pair_crypto.rs)
- [Web/local API](https://github.com/ehitimum/MnemoScript/blob/feature/ai-assistant/app/src/lib/api.ts)
- [Architecture](https://github.com/ehitimum/MnemoScript/blob/feature/ai-assistant/docs/ARCHITECTURE.md)

**Official external guidance (consult before implementation, as rules and APIs evolve):**
- [Google Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive change feed](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Drive API usage limits and pricing](https://developers.google.com/workspace/drive/api/guides/limits)
- [Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Identity Services browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)

**Note:** This is a proposal rooted in inspected source and official documentation, not a claim that sync is already implemented or that Google OAuth, network pairing, or platform flows were tested on real devices. Recheck branch, API behavior, security and quotas during implementation.
