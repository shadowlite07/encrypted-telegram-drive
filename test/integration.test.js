const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { startMockServer } = require('./mock-telegram');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('integration: upload, verify, download, folders, move, export, import', async () => {
  const mock = await startMockServer();
  const root = tempDir('telestore-int-');
  const configPath = path.join(root, 'config.json');
  const dbPath = path.join(root, 'drive.db');
  const workDir = path.join(root, '.chunks');

  fs.writeFileSync(configPath, JSON.stringify({
    bots: [{ id: 'b1', alias: 'bot1', display: 'Vault Bot 1', token: '123:ABC' }],
    channels: [{ id: '-1001', alias: 'drive1', display: 'Vault Channel 1' }],
    chunkSizeBytes: 1000,
    concurrency: 2,
    rate: { perBotChatPerMinute: 1000, globalPerSecond: 1000 },
    dbPath,
    workDir
  }, null, 2));

  fs.writeFileSync(path.join(root, 'input.bin'),
    Buffer.from(Array.from({ length: 2500 }, (_, i) => i % 256)));

  process.env.DRIVE_KEY = 'test-integration-key';
  process.env.TELEGRAM_API_BASE = mock.url;

  const { createDrive } = require('../src/index.js');
  const drive = createDrive(configPath, process.env.DRIVE_KEY, { quiet: true });

  let fileId;
  try {
    const folder = await drive.folders.create('Test Folder');
    const uploaded = await drive.files.upload(path.join(root, 'input.bin'), {
      folderId: folder.id
    });
    assert.strictEqual(uploaded.chunks, 3);
    fileId = uploaded.fileId;

    const listed = await drive.files.list({ all: true });
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].folder_id, folder.id);

    const downloaded = await drive.files.download(fileId, path.join(root, 'output.bin'));
    assert.strictEqual(downloaded.size, 2500);

    const verified = await drive.files.verify(fileId);
    assert.strictEqual(verified.verified, true);

    await drive.files.move(fileId, 'root');
    const moved = await drive.files.get(fileId);
    assert.strictEqual(moved.folder_id, null);

    const bundle = path.join(root, 'bundle.enc');
    await drive.exportBundle(bundle);
    const importedCount = await drive.importBundle(bundle);
    assert.strictEqual(importedCount, 1);

    await drive.cleanupFailed();
  } finally {
    await drive.close();
    await mock.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
