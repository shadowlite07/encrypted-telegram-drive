# Portability between machines and Google Colab

The encrypted chunks live in Telegram. Your local database (`drive.db`) stores the metadata needed to find and decrypt them.

To use the same drive on another machine, transfer the metadata and configuration, not the chunks.

## What to transfer
- `config.json` (bot tokens, channel IDs, chunk settings)
- `data/drive.db` (chunk metadata)
- `DRIVE_KEY` (same passphrase)
- Optional: `drive-bundle.enc` created with `export`

Do not transfer `.chunks/` as required data; chunks are fetched from Telegram when needed.

## Same OS / another PC
1. Install Node.js 24+.
2. Copy the project folder.
3. Copy `config.json` and `data/drive.db`.
4. Set `DRIVE_KEY`.
5. Run:
   ```powershell
   node src/cli.js doctor
   node src/cli.js list
   node src/cli.js verify <fileId>
   ```

## Use the portable bundle command
```powershell
node src/cli.js portable .\telestore-portable
```

This creates:
- `config.json`
- `drive.db`
- `drive-bundle.enc`
- `RESTORE.txt`

## Google Colab
Colab is a Python environment, but it can install and run Node.js.

### Upload approach
1. Zip your project locally, including `config.json` and `data/drive.db` if needed.
2. Upload the zip to Colab.
3. In Colab:

```python
!apt-get -qq update
!apt-get -qq install -y nodejs npm
!node --version
!unzip telestore-portable.zip -d telestore
%cd telestore
!npm install
```

4. Set the key inside Colab. Do this only in a private notebook/session:

```python
import os
os.environ["DRIVE_KEY"] = "your-strong-passphrase"
os.environ["TELEGRAM_API_BASE"] = "https://api.telegram.org"
```

5. Run commands from Colab:

```python
!node src/cli.js doctor
!node src/cli.js list
!node src/cli.js verify <fileId>
```

### Upload/download in Colab
Use the same CLI commands from Python subprocesses if needed:

```python
import subprocess
subprocess.run(["node", "src/cli.js", "upload", "input.bin"], check=True)
```

### Important Colab warnings
- Colab runtimes are ephemeral. The notebook filesystem disappears when the runtime disconnects.
- Download important files back to your machine with `files.download`.
- Keep secrets out of committed notebooks.
- Use private runtime for real bot tokens and channel IDs.

## Import/export workflow
If you do not want to transfer the raw database:

```powershell
node src/cli.js export --out .\drive-bundle.enc
```

On the other machine:

```powershell
node src/cli.js import --in .\drive-bundle.enc
```

Then run `doctor` and `verify`.
```

Create docs directory? Writing path creates parent? write tool probably creates missing parent? Earlier init made directories; write for file in docs may fail if docs dir doesn't exist. Need create via shell.<|end|><|start|><|start|>assistant to=shell<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="command">
cd "N:\Code\active\use-telegram-as-drive"; if (-not (Test-Path docs)) { New-Item -ItemType Directory -Path docs | Out-Null }; Write-Host ok