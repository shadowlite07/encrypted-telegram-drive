# use-telegram-as-drive

A Node.js tool that uses Telegram private channels as encrypted file storage, with Telegram bots acting as parallel workers.

Files are split into chunks, each chunk is encrypted with AES-256-GCM before upload. Chunk metadata is stored in a local SQLite database.

## Features
- Chunked upload/download for files larger than Telegram's 20 MB bot download limit
- AES-256-GCM encryption with PBKDF2 key derivation
- SHA-256 integrity checks for chunks and whole files
- Multiple bots and channels for parallel throughput
- Rate limiting to avoid Telegram flood errors
- Resume-friendly chunk uploading
- Download verification without writing final output
- Database backup and encrypted metadata export/import
- `doctor` command for config validation

## Use as an npm package

This repository also works as a Node package, so you do not need to clone it only to use the API.

Install from GitHub:
```powershell
npm install github:shadowlite07/encrypted-telegram-drive
```

Then use it programmatically:
```js
const { createDrive } = require('encrypted-telegram-drive');

const drive = createDrive(config, process.env.DRIVE_KEY, { quiet: true });

const folder = await drive.folders.create('Work');
const file = await drive.files.upload('./file.bin', { folderId: folder.id });

await drive.files.verify(file.fileId);
await drive.files.download(file.fileId);
await drive.close();
```

If you are developing locally in this repository, run `npm link` first, or require:
```js
const { createDrive } = require('./src/index.js');
```

### Programmatic API

Drive setup:
```js
const { createDrive } = require('encrypted-telegram-drive');

const drive = createDrive(config, process.env.DRIVE_KEY, { quiet: true });
```

Folders:
```js
await drive.folders.create('Work');
await drive.folders.create('Invoices', { parent: folderId });
await drive.folders.list();
await drive.folders.list(parentId);
await drive.folders.get(folderId);
await drive.folders.rename(folderId, 'New Name');
await drive.folders.delete(folderId);
```

Files:
```js
await drive.files.upload('./file.bin', {
  folderId,
  fresh: false,
  cleanupOnFail: false,
  onProgress: (progress) => console.log(progress)
});
await drive.files.list({ folderId, all: false, recursive: false });
await drive.files.get(fileId);
await drive.files.move(fileId, folderId);
await drive.files.move(fileId, 'root');
await drive.files.verify(fileId);
await drive.files.download(fileId);
await drive.files.download(fileId, './restored.bin');
await drive.files.delete(fileId);
```

Maintenance and portability:
```js
await drive.cleanupFailed();
await drive.backup('./backups/drive.db.copy');
await drive.exportBundle('./drive-bundle.enc');
await drive.importBundle('./drive-bundle.enc');
await drive.portable('./telestore-portable');
const health = await drive.doctor();
drive.close();
```

### Config and secrets
- `config.json` uses `${ENV_VAR}` placeholders and is safe to commit.
- `.env` is private and must not be committed.
- `.env.example` documents the required variables.
- Do not put real bot tokens or channel IDs directly in `config.json` if you plan to push it.
## Requirements
- Node.js 24 or newer
- Telegram bot(s) created via `@BotFather`
- Private Telegram channel(s) where every bot is an admin
- A strong `DRIVE_KEY`

## Setup

### 1. Install dependencies
```powershell
npm install
```

### 2. Create config
```powershell
node src/cli.js init
```

You can store secrets in `.env` and reference them from `config.json`:

```json
{
  "bots": [
    {
      "id": "b1",
      "alias": "bot1",
      "display": "Vault Bot 1",
      "token": "${BOT1_TOKEN}"
    }
  ],
  "channels": [
    {
      "id": "${DRIVE_CHANNEL_ID}",
      "alias": "drive1",
      "display": "Vault Channel 1"
    }
  ]
}
```

Example files are provided:
- `config.example.json`
- `.env.example`

Edit `config.json`:

```json
{
  "bots": [
    {
      "id": "b1",
      "alias": "bot1",
      "display": "Vault Bot 1",
      "token": "123456:ABC-REPLACE"
    }
  ],
  "channels": [
    {
      "id": "-100REPLACE",
      "alias": "drive1",
      "display": "Vault Channel 1"
    }
  ],
  "chunkSizeBytes": 16777216,
  "concurrency": 4,
  "rate": {
    "perBotChatPerMinute": 18,
    "globalPerSecond": 25
  },
  "dbPath": "./data/drive.db",
  "workDir": "./.chunks"
}
```

### 3. Set the encryption key
```powershell
$env:DRIVE_KEY = "your-strong-passphrase"
```

Generate one:
```powershell
$bytes = New-Object byte[] 64
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$env:DRIVE_KEY = [Convert]::ToBase64String($bytes)
$env:DRIVE_KEY
```

## Commands

### doctor
Validate `DRIVE_KEY`, config, bot tokens, channel access, admin status, and the local database.
```powershell
node src/cli.js doctor
```

### upload `<file>` [--fresh] [--cleanup-on-fail] [--folder <folderId>]
Split the file into encrypted chunks and upload them to Telegram.
```powershell
node src/cli.js upload .\file.bin
node src/cli.js upload .\file.bin --fresh
node src/cli.js upload .\file.bin --cleanup-on-fail
node src/cli.js upload .\file.bin --folder <folderId>
```

### folder create `<name>` [--parent <folderId>]
Create an empty folder for organizing files.
```powershell
node src/cli.js folder create Work
node src/cli.js folder create Invoices --parent <folderId>
```

### folder rename `<folderId>` `<newName>`
Rename an existing folder.
```powershell
node src/cli.js folder rename <folderId> "New Name"
```

### folder delete `<folderId>`
Delete an empty folder.
```powershell
node src/cli.js folder delete <folderId>
```

### folders [parent]
List folders in the root or under another folder.
```powershell
node src/cli.js folders
node src/cli.js folders <folderId>
```

### move `<fileId>` `<folderId|root|null>`
Move a stored file into a folder, back to root, or remove its folder assignment.
```powershell
node src/cli.js move <fileId> <folderId>
node src/cli.js move <fileId> root
```

### list [--folder <id>] [--all] [--recursive]
List folders and files. Defaults to the root folder.
```powershell
node src/cli.js list
node src/cli.js list --folder <folderId>
node src/cli.js list --all
```

### download `<fileId>` [outPath]
Download and reassemble a stored file. If `outPath` is omitted, saves to your Downloads folder.
```powershell
node src/cli.js download <fileId>
node src/cli.js download <fileId> .\restored.bin
```

### verify `<fileId>`
Download chunks to a temporary file, verify all hashes, then delete the temporary file.
```powershell
node src/cli.js verify <fileId>
```

### delete `<fileId>`
Delete a stored file and its Telegram chunks.
```powershell
node src/cli.js delete <fileId>
```

### cleanup
Delete all failed or incomplete uploads and their chunks.
```powershell
node src/cli.js cleanup
```

### backup [destination]
Create a safe SQLite backup of the metadata database.
```powershell
node src/cli.js backup
node src/cli.js backup .\backups\drive.db.copy
```

### export --out `<file>`
Create an encrypted metadata bundle for transfer or recovery.
```powershell
node src/cli.js export --out .\drive-bundle.enc
```

### import --in `<file>`
Restore metadata from an encrypted bundle.
```powershell
node src/cli.js import --in .\drive-bundle.enc
```

### portable [directory]
Create a transferable folder containing config, database, bundle, and restore notes.
```powershell
node src/cli.js portable .\telestore-portable
```

### discover
Poll Telegram updates to help find channel IDs.
```powershell
node src/cli.js discover --bot b1 --seconds 20
```
## Storage rules
- Bot API file downloads are limited to about 20 MB.
- The default chunk size is 16 MB.
- Group/channel rate limits are approximately 20 messages per minute per bot per chat.
- The app defaults are conservative: 18/min per bot+channel and 25 global requests/sec.

## Important security notes
- `DRIVE_KEY` is never uploaded and is required for decryption.
- Losing `DRIVE_KEY` means the encrypted chunks cannot be recovered.
- The local SQLite database is the source of truth for chunk metadata.
- Back up both `config.json` and `data/drive.db`.
- Do not commit secrets or the database.

## Troubleshooting

### `Unauthorized`
- Bot token is invalid or still the placeholder value.
- Recreate or copy the token from `@BotFather`.

### `chat not found`
- Channel ID is wrong.
- The bot is not an admin in that channel.

### `429 Too Many Requests`
- Lower `concurrency`, `globalPerSecond`, and `perBotChatPerMinute`.

### `File is too big`
- Keep `chunkSizeBytes` at 16 MB or lower for standard Bot API limits.

### Discovery of channel IDs
```powershell
$token = "YOUR_REAL_TOKEN"
$response = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getUpdates?timeout=10&allowed_updates=%5B%22channel_post%22,%22message%22,%22my_chat_member%22%5D"
$response | ConvertTo-Json -Depth 8
```

Post a test message in the channel during the request, or forward a channel message to `@userinfobot`.

## .gitignore suggestion
```text
config.json
data/
.chunks/
.env
```