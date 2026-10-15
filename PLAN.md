# Telegram-as-Drive (JS) — Project Plan

## 1. Goal
Use one or more private Telegram channels as object storage ("drive"), with Telegram bots acting as parallel workers to upload/download chunked, encrypted files. Supports arbitrary file sizes via chunking, rate-limit aware scheduling, and integrity verification.

## 2. Constraints (Telegram)
- Bot API file download: `getFile` max 20 MB (self-hosted Bot API can raise; default plan uses 16 MB chunks).
- Bot API upload: `sendDocument` practical max ~50 MB; 16 MB chunks avoid this.
- Rates: ~20 msgs/min per chat/channel; ~30 global msgs/sec; 1 msg/sec per individual chat.
- Text messages max 4,096 chars -> manifests stored as documents, not giant replies.
- Bots need admin rights in the storage channel(s) to post/delete.

## 3. Architecture (modules)
```
src/
  cli.js        # commands: init, upload, download, list, delete, status
  config.js     # load config.json + env (tokens, keys)
  state.js      # local state.json (index message ids, file records cache)
  telegram.js   # HTTP client, multipart upload, getFile download, deleteMessage, retry/backoff, rate limiters
  crypto.js     # PBKDF2/Argon2 key derivation, AES-256-GCM chunk enc/dec, SHA-256
  chunker.js    # split file into N chunks, reassemble in order
  storage.js    # high-level upload/download/list/delete orchestration
  scheduler.js  # worker pool + per-chat/global token buckets + 429 handling
  index.js      # channel index document (list of files -> manifest message ids)
  utils.js      # uuid, mime, paths, redaction
```

## 4. Data model
- **File record**: `id (uuid)`, `name`, `size`, `mime`, `sha256(original)`, `chunkSize`, `numChunks`, `compression`, `salt`, `kdfParams`, `createdAt`.
- **Chunk**: `{ index, size, iv, tag, sha256, telegram: { channelId, messageId, fileId } }`.
- **Manifest** (one encrypted JSON document per file in a channel): contains file record + all chunk descriptors + manifest message id of index update.
- **Index** (one encrypted JSON document per drive): array of `{ fileId, name, size, createdAt, manifestChannelId, manifestMessageId }`. Its message id stored in local `state.json` (and optionally pinned/exported).

## 5. Flows
### Upload
1. Read file, compute SHA-256, split into 16 MB chunks (optionally gzip).
2. Derive key from `DRIVE_KEY` + per-file random salt (PBKDF2, 310k iters).
3. Upload chunks in parallel subject to scheduler:
   - assign bot round-robin, channel round-robin (distinct channels increase throughput)
   - each chunk -> `sendDocument` with caption `chunk:<fileId>:<index>`
   - record returned `message_id`, `file_id`, `iv`, `tag`, chunk hash
4. Upload encrypted manifest document; store its message id.
5. Update (re-upload) index document with new file entry; store new index message id in state. Delete old index message (best effort).
6. Verify: re-download one or all chunks? Optional `--verify`.

### Download
1. Load index (or accept manifest message id directly), find file.
2. Download manifest, decrypt, validate.
3. Fetch chunks (bot `getFile`) in parallel with bounded concurrency, decrypt+verify each hash.
4. Assemble in order to output path; verify full-file SHA-256.
5. Clean temp.

### Delete
- Delete manifest message + all chunk messages; update index.

### List
- Read index document (message id from state). MTProto mode can enumerate channel history for portability (optional).

## 6. Rate limiting / scheduling
- Per `(bot, channel)` token bucket: default 18/60s (slightly under 20/min).
- Global bucket: 25/sec (slightly under 30/sec).
- Individual-chat bucket only if target is a user chat.
- Scheduler queue with priority (manifest/index last), concurrency cap (default 4), automatic retry on HTTP 429 using `retry_after` (seconds) + jitter, exponential backoff on 5xx.
- Round-robin bot & channel assignment; on 429, try next worker if available.

## 7. Security
- Client-side AES-256-GCM per chunk; key never sent to Telegram.
- Per-file random salt + random 12-byte IV per chunk; GCM auth tag stored.
- Original & chunk SHA-256 for integrity; GCM also authenticates.
- Config redacts bot tokens in logs.
- `DRIVE_KEY` from env or interactive prompt (never persisted).
- Encryption protects content confidentiality but NOT metadata size/timing.

## 8. CLI
```
node src/cli.js init                      # create config + state skeleton
node src/cli.js upload <path> [--name] [--verify]
node src/cli.js download <fileId> <out> [--verify]
node src/cli.js list
node src/cli.js delete <fileId>
node src/cli.js status
```
Uses Node built-in `util.parseArgs` (no CLI dep). Optional deps: none beyond Node 24 standard library (fetch, crypto, fs).

## 9. Portability & indexing
- Bot API cannot list channel history. Therefore:
  - **Default**: local `state.json` holds index message id + file records cache. Portable via exporting state.
  - **Optional MTProto mode** (gramjs): enumerate history to discover index/manifests. Adds dependency + login session. Enable only if requested.

## 10. Error handling
- Partial upload failure: delete already-uploaded chunks for that file? Either keep resumable manifest (missing chunks) and support `upload --resume`. Plan: support resume by reusing existing manifest chunks where `message_id` present; re-upload missing.
- Checkpoint state after each chunk so crashes are recoverable.

## 11. Non-goals / cautions
- Not a general filesystem (no random writes; append-only chunks).
- Respect Telegram ToS and applicable law; encryption does not immunize abuse.
- Do not use to exfiltrate/copyright content you do not own.

## 12. Proposed MVP (phase 1)
- Config + state + telegram client (with rate limiter)
- Crypto + chunker
- Upload (single bot/channel) + manifest + index
- Download + verify
- list/delete
- Multi-bot/channel scheduling + resume (phase 2)

## 13. Decisions needed from you (tell me add/remove)
- Keep MTProto listing? (adds dependency/login)
- Compression (gzip) before encryption?
- Chunk size (16 MB default; max 20 MB download limit?)
- KDF (PBKDF2 built-in vs Argon2 via dep)
- Concurrency default (4) and rate aggressiveness
- Resume support in MVP or later
- Store originals' file names in manifest (encrypted) — yes by default
- Multi-channel from start or single-channel MVP
- Delete messages vs keep? (delete by default)
- Local cache of downloaded chunks? (no by default)
```

Tell me which to add/remove/change; then I'll implement.