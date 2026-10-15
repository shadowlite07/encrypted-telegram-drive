# Portability and Colab

Use this page for where TeleStore can be run portable. For setup commands, use `README.md`; for Colab, use `colab.ipynb`.

## Where package mode is used
- Local automation scripts
- Other Node.js projects
- CI jobs
- Google Colab as shown in the notebook

## What a portable transfer needs
- Bot tokens and channel IDs, either in `.env` or config values
- The same `DRIVE_KEY`
- `config.json`
- `data/drive.db`, or an export bundle created with `node src/cli.js export --out file`

Chunks themselves remain in Telegram and do not need to be transferred.

## Create a portable bundle
```powershell
node src/cli.js portable .\telestore-portable
```

## Restore a portable bundle
1. Install Node.js and `npm install`
2. Copy the bundle into the project directory
3. Set `DRIVE_KEY` to the original value
4. Run `node src/cli.js doctor`
5. Run `node src/cli.js verify <fileId>`

## Google Colab
- Use `colab.ipynb`
- It installs the package from GitHub
- It runs through the npm package API, not the repository CLI
- Download `data/drive.db` before the Colab runtime disconnects

## Notes
- `config.json` is safe to transfer because secrets should live in `.env`
- Telegram chunks are not transferred by these commands; metadata is what makes the drive portable
- If the database is lost but the bundle exists, restore it with `import`
