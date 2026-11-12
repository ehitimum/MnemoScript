# MnemoDrive: Google Drive sync

Implemented 2026-11-13 on `codex/mnemosync-drive` (stacked on the Phase 0 backup branch).
Optional and per project: nothing leaves the device until the writer connects Google Drive and
turns sync on for a project. Local saves never wait for, or depend on, sync.

## What is built

| Piece | Where | Notes |
|---|---|---|
| Sync engine (transport-neutral) | `src-tauri/src/sync/{model,engine,store,portable}.rs` | Revisions, merge, conflicts, outbox; LAN can plug in through the same `Transport` trait |
| Google Drive transport | `src-tauri/src/sync/drive/api.rs` | `appDataFolder`, immutable files, changes feed, error classes |
| Desktop sign-in | `src-tauri/src/sync/drive/auth.rs` | Loopback + PKCE in the system browser, refresh token in the OS keychain |
| Android sign-in | `gen/android/.../GoogleAuthPlugin.kt` + inline `google-auth` plugin | Google Play services AuthorizationClient, no refresh token stored |
| Worker + commands | `src-tauri/src/sync/service.rs` | Debounced after saves, polls every 90 s, backoff to 15 min |
| UI | `src/components/sync/*`, `src/lib/sync/*` | Settings card (both shells), status pill, open-chapter banner, conflict review |

Not built (deliberately): Smart Merge of independently created copies, LAN sync, web/browser sync,
IndexedDB storage, sync of AI conversations, history pruning. See "Follow-ups".

## Model (how this reuses the local-sync design)

The plan's local-sync design (ADR 001–002) is implemented as the shared engine, not as Drive code:

- **Entities.** A project is split into `project` (name/description/author), `folder:<id>`,
  `doc:<id>` (title/type/order/folder), `text:<id>` (body, by SHA-256) and `asset:<file>`
  (image bytes, by SHA-256). A move on one device and a text edit on another touch different
  entities, so both apply. Per-device project settings (`ai`, `path`) are never synced.
- **Revisions.** `rev = sha256(entity, sorted parents, canonical payload)`: independent of device
  and clock, so two devices that reach the same merge produce the same id and deduplicate.
  Received revisions are re-hashed and rejected if they do not match. A payload of `null` is a
  tombstone.
- **Capture.** After every round's start, `scan` compares the files on disk with the engine's
  last known state and records each difference as a revision (parent = previous disk revision).
  The disk stays the source of truth, so a crash between a save and the next scan loses nothing:
  the next scan sees the change. Save commands only *nudge* the worker.
- **Apply.** Batches wait until all parents and blobs are present. Per entity, the maximal heads
  decide: one head = fast-forward; metadata = deterministic three-way field merge (same result on
  every device, a note when a field truly collided); text = keep this device's version in place
  and preserve the others as conflict heads; edit beats delete for both text and chapters. After
  applying, `repair` keeps the tree valid (no chapter in a deleted folder, no folder cycles).
- **Open chapter.** The app reports the open chapter. Its text (and its removal) is staged, never
  written under the editor; title/folder/order changes do apply and the app merges them into the
  open document without touching unsaved typing. "Load it" saves first, then applies; typing
  before accepting turns into a conflict, never a silent overwrite.
- **Conflicts.** The writer compares versions side by side (plain text, parsed inertly) and keeps
  one in place; by default every other version becomes its own chapter named after its device.
  The resolution is a merge revision whose parents are all heads.
- **Portable images.** Synced text replaces `<project>/assets/<file>` references with
  `mnemo-asset:<file>` (`<img src>` in chapters, whole string values in map JSON, including
  "My Imports"), and each device turns them back into its own absolute path. Disk format is
  unchanged, so no migration of existing projects is needed.

State lives in `<data dir>/sync/mnemosync.db` (SQLite, WAL), outside every project folder and
never synced or backed up. Debug builds use `~/.mnemoscript-dev`, so development never touches
the installed app's sync state.

## Google Drive layout

Only the hidden `appDataFolder` (scope `https://www.googleapis.com/auth/drive.appdata`). Files
are flat; `appProperties` carry the query keys (`m=1`, `k`, `p`, `d`, `s`, `h`):

```
mnemo-b-<project>-<sha256>          gzip blob: chapter text or image bytes   k=b
mnemo-o-<project>-<device>-<seq>    gzip JSON batch of revisions              k=o (commit marker)
mnemo-i-<project>-<device>          JSON catalogue entry (name, device)       k=i (own file only)
```

- Blobs are uploaded and recorded before the batch that references them; a batch is frozen in
  SQLite before upload, so a crash retries the *same* bytes under the same sequence number.
- `put_batch` checks for an existing `(device, seq)` file first; receivers keep the first file for
  a `(device, seq)` and ignore duplicates and files whose content contradicts their labels.
- New batches are found through `changes.list` (one cursor per Google account, taken *before*
  the first listing); an expired cursor falls back to a full listing, never to deletion.
- Downloads are capped at 256 MiB decompressed; uploads above 4 MiB use a resumable session.
- 401 refreshes once, then pauses as `needs-auth`; 403 quota = "Drive full"; 403 rate limits,
  429 and 5xx back off (30 s doubling to 15 min); network errors keep everything queued.
- The Google account is identified by Drive's `permissionId`. A device refuses to switch to a
  different account while projects are synced with the previous one.

Drive data is protected in transit and at rest by Google but **not end-to-end encrypted**, and
sync is **not a backup** (the Settings card says so; keep project backups).

## Setting up Google sign-in (your own Google Cloud project)

MnemoScript has no server and ships no OAuth client. Each build uses an OAuth client from the
writer's (or publisher's) own Google Cloud project.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (e.g.
   "MnemoScript") and enable the **Google Drive API** (APIs & Services → Library).
2. Google Auth Platform → **Branding**: app name, support email. **Audience**: External; while in
   *Testing*, add your own Google account as a test user. **Data access**: add the scope
   `https://www.googleapis.com/auth/drive.appdata` (non-sensitive; no other scope is needed).
3. **Clients → Create client → Desktop app.** Copy the client ID and secret into
   `app/src-tauri/.env.local` (git-ignored; template in `.env.local.example`):
   ```
   MNEMO_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
   MNEMO_GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```
   Google documents an installed-app client secret as not confidential, but keep it out of git.
   Rebuild (`npm run tauri dev` / `tauri build`). Settings → *Sync with Google Drive* → Connect.
4. **Android:** in the *same* Cloud project, create an **Android** client for package
   `com.mnemoscript.app` with the SHA-1 of the certificate that signs the APK. For debug builds:
   `keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android`.
   Release builds need the release certificate's SHA-1 (run `keytool` yourself; never paste
   keystore passwords anywhere). No client ID is compiled into the Android app.
5. **Testing-mode limit:** Google expires refresh tokens after 7 days for apps in *Testing* that
   use non-basic scopes. Expect a weekly "Reconnect" on desktop until the consent screen is
   published (non-sensitive scope: no security assessment, but Google may verify branding).

All clients must belong to one Cloud project: the hidden app folder is shared between them for
the same Google account. Confirm this on real devices before relying on it.

## Follow-ups

- Real-device acceptance: desktop ↔ Android with one account, offline catch-up, expiry and
  quota behaviour, account switch. Nothing here was verified against live Google services.
- Smart Merge (Phase 2) to link projects that were created separately on two devices.
- LAN transport (Phase 4) reusing `engine::Transport` and the same revision ids.
- History/blob pruning with per-device acknowledgements (local `blobs` table and Drive files
  grow with every synced revision today).
- Web sync (GIS token model + IndexedDB) and opt-in AI-conversation sync.
