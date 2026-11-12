# MnemoSync schema and migration contract

## Recovery ZIP v1

File `mnemoscript-backup.json` has `format: "mnemoscript-project-backup"`, `schemaVersion: 1`,
`projectId`, `sourceRoot`, and a `files` map keyed by relative `/` paths. Each value is
`{size, sha256}` for the exact archived bytes. The manifest does not checksum itself. It is
bounded and version checked; digests do not authenticate the archive author. Future versions
must add an explicit reader/migration path; unknown versions fail without activation.

The archive preserves allowlisted source bytes including unknown JSON metadata. Restore changes
only project UUID/path and a visible `(restored)` name suffix, disconnects project AI configuration, remaps image references, and
serializes the affected JSON. Document/folder IDs, manuscript formatting/content, graph node
IDs, sessions and asset bytes remain. Original metadata remains in the unmodified ZIP. Restored
project JSON has a content-free document index; per-document files remain authoritative.

Restore is a separate local copy, not adoption of the original sync identity. A later Smart Merge
must explicitly link these identities. No SQLite, IndexedDB, asset-URI or sync-schema migration
runs in Phase 0. There is no change to existing project save/open APIs or AI pairing permissions.

Native command boundary: `backup_project({projectId}) -> ApiResponse<string>` creates a unique
archive in the app's sibling `backups/` directory; `restore_project_backup` accepts a raw ZIP body
and returns the registered Project. Compression/extraction run on a worker. Frontend `lib/api.ts`
unwraps envelopes and uses plugin filesystem/dialog APIs for an optional user-selected archive
copy. The restore picker reads a user-selected ZIP as binary, with an early size check.

Backend tooling now requires Rust 1.88 or newer for ZIP 9.5; CI already installs stable. Lockfile
records exact dependency resolutions. ZIP only enables pure-Rust deflate, without unrelated
compression/encryption backends.

## Next schemas (design only)

Native SQLite migrations will version durable write intents, revision hashes/heads, operation
IDs and origin sequences, outbox/inbox, per-destination receipts, account namespaces, tombstones,
merge aliases/journals. Retain native JSON, support interrupted migration/recovery, and refuse
unsupported mandatory protocol versions.

Web IndexedDB migration must transactionally copy and verify localStorage projects and
`mnemoscript:ai-sessions:*`, retain legacy source until verification, and support interruption,
quota failure, tab races, old projects and no-login/offline use. Asset hashes/URIs require a
separate compatibility migration with readable-byte validation and missing-asset reporting.
