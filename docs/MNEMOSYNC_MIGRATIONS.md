# MnemoSync schema and migration contract

## Recovery ZIP v2 (2026-11-15)

Schema 2 drops `sourceRoot`: chapters and maps refer to project images as `mnemo-asset:<file in
assets/>`, so an archive never records where (or under which OS user) the project lived. Restore
maps those to the new folder; unknown ones stay as harmless references. An optional `damaged`
list names chapter files that could not be read at backup time; they are archived and restored
byte for byte. Every other chapter is still validated strictly on restore. Readers accept schema
1 (below) unchanged.

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

Native command boundary (2026-11-15): `backup_project({projectId}) -> {path, fileName,
warnings}` writes a named archive in the app's sibling `backups/` directory and keeps the newest
5 per project; `list_backups` / `delete_backup({path})` only name files directly in that folder;
`save_backup_copy({source, destination})` copies file to file; `restore_project_backup({path})`
opens the dialog-picked ZIP in Rust (bounded reads, no whole-archive copy in memory) and returns
the registered Project. Compression/extraction run on a worker.

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
