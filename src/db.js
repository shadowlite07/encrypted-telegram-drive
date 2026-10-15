const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try { db.prepare('ALTER TABLE files ADD COLUMN manifest_telegram_file_id TEXT').run(); } catch (e) {}
  db.exec(`
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

module.exports = { openDb, getMeta, setMeta, upsertFile, getFile, listFiles, upsertChunk, getChunk, listChunks, deleteFileRows };
