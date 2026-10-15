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

### Validate setup
```powershell
node src/cli.js doctor
```

### Upload
```powershell
node src/cli.js upload .\file.bin
node src/cli.js upload .\file.bin --fresh
node src/cli.js upload .\file.bin --cleanup-on-fail
node src/cli.js upload .\file.bin --folder <folderId>
```

### Folders
```powershell
node src/cli.js folders
node src/cli.js folders <folderId>
node src/cli.js folder create <name>
node src/cli.js folder create <name> --parent <folderId>
node src/cli.js folder rename <folderId> <newName>
node src/cli.js folder delete <folderId>
node src/cli.js list
node src/cli.js list --folder <folderId>
node src/cli.js list --all
node src/cli.js move <fileId> <folderId|root|null>
```

### List
```powershell
node src/cli.js list
```

### Download
```powershell
node src/cli.js download <fileId>
node src/cli.js download <fileId> .\custom-output.bin
```

If no output path is given, the file is saved to your Downloads folder.

### Verify
```powershell
node src/cli.js verify <fileId>
```

### Delete
```powershell
node src/cli.js delete <fileId>
```

### Cleanup failed uploads
```powershell
node src/cli.js cleanup
```

### Backup database
```powershell
node src/cli.js backup
node src/cli.js backup .\backups\drive.db.copy
```

### Export/import metadata bundle
```powershell
node src/cli.js export --out .\drive-bundle.enc
node src/cli.js import --in .\drive-bundle.enc
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