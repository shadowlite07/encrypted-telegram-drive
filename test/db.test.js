const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const dbm = require('../src/db');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telestore-db-'));
  return {
    dir,
    path: path.join(dir, 'test.db'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

test('db: folders and files persist folder_id', () => {
  const dbInfo = tempDb();
  const db = dbm.openDb(dbInfo.path);
  const now = new Date().toISOString();

  dbm.createFolder(db, { id: 'f1', name: 'Work', parent_id: null, created_at: now, status: 'active' });
  assert.ok(dbm.getFolder(db, 'f1'));
  assert.equal(dbm.listFolders(db, null).length, 1);

  dbm.upsertFile(db, {
    id: 'file1', source_path: 'a.txt', name: 'a.txt', size: 10, mime: 'text/plain',
    sha256: 'hash', chunk_size: 1000, num_chunks: 1, compression: 'none',
    salt: 'salt', kdf: 'pbkdf2', iterations: 1000, created_at: now, status: 'ready',
    folder_id: 'f1', manifest_channel_id: null, manifest_message_id: null, manifest_telegram_file_id: null
  });

  assert.equal(dbm.getFile(db, 'file1').folder_id, 'f1');

  dbm.moveFileToFolder(db, 'file1', null);
  assert.equal(dbm.getFile(db, 'file1').folder_id, null);

  const files = dbm.listFilesInFolder(db, 'f1');
  assert.equal(files.length, 0);

  db.close();
  dbInfo.cleanup();
});
