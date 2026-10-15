const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try { db.prepare('ALTER TABLE files ADD COLUMN manifest_telegram_file_id TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN folder_id TEXT').run(); } catch (e) {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      source_path TEXT,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT,
      sha256 TEXT NOT NULL,
      chunk_size INTEGER NOT NULL,
      num_chunks INTEGER NOT NULL,
      compression TEXT NOT NULL DEFAULT 'none',
      salt TEXT,
      kdf TEXT NOT NULL DEFAULT 'pbkdf2',
      iterations INTEGER NOT NULL DEFAULT 310000,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploading',
      manifest_channel_id TEXT,
      manifest_message_id TEXT,
      manifest_telegram_file_id TEXT
    );
    CREATE TABLE IF NOT EXISTS chunks (
      file_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      size INTEGER NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      telegram_file_id TEXT,
      PRIMARY KEY (file_id, idx),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return row ? row.value : null;
}
function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function upsertFile(db, file) {
  const stmt = db.prepare(`
    INSERT INTO files (id,source_path,name,size,mime,sha256,chunk_size,num_chunks,compression,salt,kdf,iterations,created_at,status,manifest_channel_id,manifest_message_id,manifest_telegram_file_id)
    VALUES (@id,@source_path,@name,@size,@mime,@sha256,@chunk_size,@num_chunks,@compression,@salt,@kdf,@iterations,@created_at,@status,@manifest_channel_id,@manifest_message_id,@manifest_telegram_file_id)
    ON CONFLICT(id) DO UPDATE SET
      source_path=excluded.source_path,name=excluded.name,size=excluded.size,mime=excluded.mime,sha256=excluded.sha256,
      chunk_size=excluded.chunk_size,num_chunks=excluded.num_chunks,compression=excluded.compression,salt=excluded.salt,kdf=excluded.kdf,
      iterations=excluded.iterations,status=excluded.status,manifest_channel_id=excluded.manifest_channel_id,manifest_message_id=excluded.manifest_message_id,manifest_telegram_file_id=excluded.manifest_telegram_file_id
  `);
  stmt.run(file);
}

function getFile(db, id) { return db.prepare('SELECT * FROM files WHERE id=?').get(id); }
function listFiles(db) { return db.prepare("SELECT * FROM files WHERE status!='deleted' ORDER BY created_at DESC").all(); }
function upsertChunk(db, c) {
  db.prepare(`
    INSERT INTO chunks (file_id,idx,size,iv,tag,sha256,channel_id,message_id,telegram_file_id)
    VALUES (@file_id,@idx,@size,@iv,@tag,@sha256,@channel_id,@message_id,@telegram_file_id)
    ON CONFLICT(file_id,idx) DO UPDATE SET
      size=excluded.size,iv=excluded.iv,tag=excluded.tag,sha256=excluded.sha256,channel_id=excluded.channel_id,
      message_id=excluded.message_id,telegram_file_id=excluded.telegram_file_id
  `).run(c);
}
function getChunk(db, fileId, idx) { return db.prepare('SELECT * FROM chunks WHERE file_id=? AND idx=?').get(fileId, idx); }
function listChunks(db, fileId) { return db.prepare('SELECT * FROM chunks WHERE file_id=? ORDER BY idx ASC').all(fileId); }
function deleteFileRows(db, fileId) {
  db.prepare('DELETE FROM chunks WHERE file_id=?').run(fileId);
  db.prepare('DELETE FROM files WHERE id=?').run(fileId);
}

function createFolder(db, folder) {
  db.prepare(`
    INSERT INTO folders (id, name, parent_id, created_at, status)
    VALUES (@id, @name, @parent_id, @created_at, @status)
  `).run(folder);
  return folder;
}

function getFolder(db, id) {
  return db.prepare('SELECT * FROM folders WHERE id=? AND status != ?').get(id, 'deleted');
}

function listFolders(db, parentId = null) {
  if (parentId === null || parentId === undefined) {
    return db.prepare('SELECT * FROM folders WHERE parent_id IS NULL AND status != ? ORDER BY name ASC').all('deleted');
  }
  return db.prepare('SELECT * FROM folders WHERE parent_id = ? AND status != ? ORDER BY name ASC').all(parentId, 'deleted');
}

function renameFolder(db, id, name) {
  db.prepare('UPDATE folders SET name=? WHERE id=?').run(name, id);
}

function deleteFolder(db, id) {
  const subFolders = listFolders(db, id).length;
  const files = listFilesInFolder(db, id).length;
  if (subFolders > 0 || files > 0) {
    throw new Error(`Folder is not empty (${subFolders} subfolders, ${files} files)`);
  }
  db.prepare("UPDATE folders SET status='deleted' WHERE id=?").run(id);
}

function listAllFolders(db) {
  return db.prepare("SELECT * FROM folders WHERE status != 'deleted'").all();
}

function upsertFolder(db, folder) {
  db.prepare(`
    INSERT INTO folders (id, name, parent_id, created_at, status)
    VALUES (@id, @name, @parent_id, @created_at, @status)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, parent_id=excluded.parent_id, created_at=excluded.created_at, status=excluded.status
  `).run(folder);
}

function moveFileToFolder(db, fileId, folderId) {
  db.prepare('UPDATE files SET folder_id=? WHERE id=?').run(folderId || null, fileId);
}

function listFilesInFolder(db, folderId, recursive = false) {
  if (!recursive) {
    if (folderId === null || folderId === undefined || folderId === '/') {
      return db.prepare("SELECT * FROM files WHERE (folder_id IS NULL OR folder_id = '' OR folder_id = '/') AND status != 'deleted' ORDER BY name ASC").all();
    }
    return db.prepare("SELECT * FROM files WHERE folder_id = ? AND status != 'deleted' ORDER BY name ASC").all(folderId);
  }
  // recursive: collect folder ids then files
  const ids = new Set([folderId]);
  const stack = [folderId];
  while (stack.length) {
    const current = stack.pop();
    for (const f of listFolders(db, current === '/' ? null : current)) {
      ids.add(f.id);
      stack.push(f.id);
    }
  }
  const placeholders = [...ids].map(() => '?').join(',');
  return db.prepare(`SELECT * FROM files WHERE folder_id IN (${placeholders}) AND status != 'deleted' ORDER BY name ASC`).all(...ids);
}

module.exports = {
  openDb, getMeta, setMeta, upsertFile, getFile, listFiles, listFilesInFolder, upsertChunk, getChunk, listChunks, deleteFileRows,
  createFolder, getFolder, listFolders, listAllFolders, renameFolder, deleteFolder, moveFileToFolder, upsertFolder
};
