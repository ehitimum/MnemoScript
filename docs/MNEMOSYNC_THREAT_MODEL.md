# MnemoSync threat model and release gates

Reviewed scope: 2026-11-12. Threats are requirements, not claims that future transports exist.

## Assets and boundaries

Protect manuscript text, revisions, graph/map data, binary assets, private AI conversations,
project identity mappings, device keys, Google tokens and local paths. Boundaries are untrusted
archives, peer networks, Drive/account namespaces, the browser origin and local persistence.
An attacker with arbitrary write access to the operating-system account is outside the initial
archive threat model; a checksum is not a digital signature.

| Capability | Default | Explicit grant required |
|---|---|---|
| Local writing and manual backup | Local only | No network identity needed |
| Restore ZIP | New local project only | User chooses an archive |
| AI inference pairing | Existing AI-only grant | Does not grant sync access |
| Sync discovery | Opaque device/service identity | No project catalogue before auth |
| Sync project read/write | Denied | Separate device trust and project grant |
| Drive | Disabled | Authorize intended account and choose projects |
| AI conversations in sync | Excluded | Future separate opt-in |

## Archive controls

- Accept only schema 1 and the declared file inventory; verify length and SHA-256 for every file
  before activation. Require project identity match and valid document/folder relationships.
- Allow `project.json`, `documents/*.json`, `assets/**`, `ai/sessions/*.json`, `exports/**`.
  Exclude app-level secrets, registry, sync state, device grants and arbitrary root files.
- Reject absolute paths, dot segments, backslashes, NTFS alternate streams, control characters,
  Windows reserved names, case collisions, duplicate ZIP entries, links and special files.
- Bound archive input to 600 MiB, uncompressed data to 512 MiB, each file to 128 MiB, inventory to
  10,000 files, manifest to 4 MiB. Read/decompress with a limit, not trusting ZIP header sizes.
- Refuse linked source entries including Windows reparse points. Reject missing/external local
  image references rather than announce a recoverable backup with missing image bytes.
- Never overwrite an existing backup. Delete only incomplete files/stages owned by that operation.
  Interrupted private `.restore-*` folders are never listed or activated; retain for manual
  inspection rather than broadly deleting them at startup. No automatic backup expiry/pruning.
- Hash inventory before and after creation; if a concurrent save changes it, fail with retry.
  This detects changes but is not a filesystem-wide transactional snapshot; pause editing during
  backup. The future journal layer must coordinate every local writer for stronger guarantees.
- Restore writes and verifies a new staging directory, then renames and registers the new project.
  An interruption after activation but before registration leaves recoverable files, not deletion.
- Archives are unencrypted and include private AI sessions. Explain this in settings and encourage
  a separate off-device copy. A backup in app-private storage is not device-loss protection.

## Future transport controls

LAN: authenticated encryption, fresh nonces, purpose/direction binding, replay rejection, bounded
frames/concurrency, project grants on every request, revocation that closes live sessions, no path
arguments from peers. Test untrusted Wi-Fi, hostile discovery, replay and denial of service.

Drive: narrow scope; tokens never in project snapshots, localStorage or diagnostic logs. Account
namespaces and pending queues stay isolated. Publish blobs before batches; validate hashes before
reference application; back off on errors; never turn missing cloud data into mass local deletion.
Drive transport is not automatically end-to-end encryption or independent backup.

Implemented Drive controls (2026-11-13): scope `drive.appdata` only; desktop PKCE S256 + state
check on a 127.0.0.1 loopback, refresh token in the OS keychain (debug builds use a separate
service), access tokens memory-only, nothing token-related in logs, project files or the web
view; Android keeps no refresh token. Remote revisions are re-hashed and rejected on mismatch;
entity ids and asset names are validated before they become file names; blobs are hash-checked,
downloads capped at 256 MiB decompressed; batch files whose labels contradict their content are
ignored. Expired change cursors trigger a re-listing, never deletion. Remote deletes of the open
chapter are staged; edit beats delete. Conflict previews render plain text from an inert parse.
Account switches are refused while projects are bound to the previous account.

Merge/replay: preserve all concurrent heads, reject mismatched operation identities, retain
tombstones and source snapshots; journal interrupted merges; never overwrite active editor
content during composition. Test malicious HTML and graph payloads at rendering boundaries.

## Pending validation

Actual Windows and Android round trips, Android save-picker access and off-device archive copy,
crash/power-loss fault injection, real LAN peers, Google OAuth client configuration/account
switches, API quota handling, browser compatibility, large-project memory/performance and soak.
No public sync release until these gates have explicit evidence in the test matrix.
