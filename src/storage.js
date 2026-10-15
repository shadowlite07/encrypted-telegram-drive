const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dbm = require('./db');
const cryptoMod = require('./crypto');
const { bot: makeBot } = require('./telegram');

function readChunk(filePath, offset, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function printProgress(label, completed, total, start) {
  const elapsed = (Date.now() - start) / 1000;
  const rate = elapsed > 0 ? completed / elapsed : 0;
  const remaining = total - completed;
  const eta = rate > 0 ? (remaining / rate).toFixed(1) : '?';
  process.stdout.write(`\r[${label}] ${completed}/${total} chunks | ${rate.toFixed(2)} chunks/s | ETA ${eta}s`);
  if (completed === total) process.stdout.write('\n');
}

function findBot(cfg, id) { return cfg.bots.find(b => b.id === id) || cfg.bots[0]; }
function findChannel(cfg, id) { return cfg.channels.find(c => c.id === id) || cfg.channels[0]; }
function botClient(cfg, botCfg) { return makeBot(botCfg.token); }

async function deriveMasterKey(cfg, db, password) {
  let saltHex = dbm.getMeta(db, 'globalSalt');
  if (!saltHex) {
    const s = cryptoMod.randomSalt(16);
    saltHex = s.toString('hex');
    dbm.setMeta(db, 'globalSalt', saltHex);
  }
  const salt = Buffer.from(saltHex, 'hex');
  return cryptoMod.deriveKey(password, salt, 310000, 32);
}

async function uploadFile(ctx, filePath) {
  const { cfg, db, scheduler, password } = ctx;
  const fsStat = fs.statSync(filePath);
  const name = path.basename(filePath);
  const mime = 'application/octet-stream';
  const fileSha = await cryptoMod.sha256File(filePath);
  let cand = dbm.listFiles(db).find(f =>
    f.source_path === filePath &&
    f.status !== 'ready' &&
    f.size === fsStat.size &&
    (f.folder_id || null) === (ctx.folderId || null)
  );
  if (ctx.fresh && cand) {
    try { await deleteFileCmd(ctx, cand.id); } catch (e) {}
    cand = null;
  }
  const fileId = cand ? cand.id : require('node:crypto').randomUUID();
  const chunkSize = cfg.chunkSizeBytes;
  const numChunks = Math.ceil(fsStat.size / chunkSize) || 1;
  const salt = cryptoMod.randomSalt(16);

  const fileRec = {
    id: fileId,
    source_path: filePath,
    name,
    size: fsStat.size,
    mime,
    sha256: fileSha,
    chunk_size: chunkSize,
    num_chunks: numChunks,
    compression: 'none',
    salt: cand && cand.salt ? cand.salt : salt.toString('hex'),
    kdf: 'pbkdf2',
    iterations: 310000,
    created_at: cand && cand.created_at ? cand.created_at : new Date().toISOString(),
    status: 'uploading',
    folder_id: ctx.folderId || null,
    manifest_channel_id: null,
    manifest_message_id: null,
    manifest_telegram_file_id: null
  };
  if (cand) {
    const c = dbm.getFile(db, cand.id);
    fileRec.created_at = c.created_at;
    fileRec.salt = c.salt;
  }
  dbm.upsertFile(db, fileRec);

  const key = await cryptoMod.deriveKey(password, Buffer.from(fileRec.salt, 'hex'), fileRec.iterations, 32);

  const specs = [];
  const startTime = Date.now();
  for (let index = 0; index < numChunks; index++) {
    const botCfg = cfg.bots[index % cfg.bots.length];
    const channelCfg = cfg.channels[index % cfg.channels.length];
    specs.push({ index, botCfg, channelCfg, run: async () => {
      const existingChunk = dbm.getChunk(db, fileId, index);
      if (existingChunk && existingChunk.message_id && existingChunk.telegram_file_id) {
        return existingChunk;
      }
      const offset = index * chunkSize;
      const actualLen = fsStat.size === 0 ? 0 : Math.min(chunkSize, fsStat.size - offset);
      const plaintext = fsStat.size === 0 ? Buffer.alloc(0) : readChunk(filePath, offset, actualLen);
      const enc = cryptoMod.encryptBuffer(key, plaintext);
      const chunkSha = cryptoMod.sha256Buffer(plaintext);
      const client = botClient(cfg, botCfg);
      const safeName = String(name).replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'file';
      const pad = String(numChunks).length < 2 ? 2 : String(numChunks).length;
      const filename = numChunks === 1
        ? `${safeName}.enc`
        : `${safeName}_${String(index + 1).padStart(pad, '0')}_of_${String(numChunks).padStart(pad, '0')}.enc`;
      const caption = `chunk:${fileId}:${index}`;
      const resp = await client.sendDocument(channelCfg.id, enc.ciphertext, filename, caption);
      const chunkRec = {
        file_id: fileId,
        idx: index,
        size: plaintext.length,
        iv: enc.iv.toString('hex'),
        tag: enc.tag.toString('hex'),
        sha256: chunkSha,
        channel_id: channelCfg.id,
        message_id: String(resp.message_id),
        telegram_file_id: resp.document ? resp.document.file_id : null
      };
      dbm.upsertChunk(db, chunkRec);
      return chunkRec;
    }});
  }

  let completedChunks = 0;
  const chunkResults = await Promise.all(specs.map(s =>
    scheduler.schedule({ botId: s.botCfg.id, channelId: s.channelCfg.id, priority: 1 }, s.run).then((r) => {
      completedChunks += 1;
      printProgress('upload', completedChunks, numChunks, startTime);
      return r;
    })
  ));

  try {
    // Manifest/chunk metadata is stored locally in SQLite only.
    // Telegram receives only the encrypted chunk files.
    fileRec.manifest_channel_id = null;
    fileRec.manifest_message_id = null;
    fileRec.manifest_telegram_file_id = null;
    fileRec.status = 'ready';
    dbm.upsertFile(db, fileRec);
    return { fileId, name, size: fsStat.size, chunks: numChunks };
  } catch (e) {
    fileRec.status = 'failed';
    dbm.upsertFile(db, fileRec);
    if (ctx.cleanupOnFail) {
      const chunks = dbm.listChunks(db, fileId);
      const client = botClient(cfg, cfg.bots[0]);
      for (const c of chunks) {
        if (c.channel_id && c.message_id) {
          try { await client.deleteMessage(c.channel_id, Number(c.message_id)); } catch (err) {}
        }
      }
      dbm.deleteFileRows(db, fileId);
    }
    throw e;
  }
}

async function downloadFile(ctx, fileId, outPath) {
  const { cfg, db, password, scheduler } = ctx;
  const fileRec = dbm.getFile(db, fileId);
  if (!fileRec) throw new Error(`Unknown file id: ${fileId}`);
  if (!outPath) {
    const downloads = path.join(os.homedir(), 'Downloads');
    fs.mkdirSync(downloads, { recursive: true });
    let candidate = path.join(downloads, fileRec.name || fileId);
    if (fs.existsSync(candidate)) {
      const ext = path.extname(candidate);
      const base = path.basename(candidate, ext);
      const dir = path.dirname(candidate);
      let i = 1;
      while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i += 1;
      candidate = path.join(dir, `${base} (${i})${ext}`);
    }
    outPath = candidate;
  }
  const chunks = dbm.listChunks(db, fileId);
  if (!chunks.length) throw new Error(`No chunks found for file id: ${fileId}`);
  const key = await cryptoMod.deriveKey(password, Buffer.from(fileRec.salt, 'hex'), fileRec.iterations, 32);

  const resolvedOut = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  const fd = fs.openSync(resolvedOut, 'w');
  if (fileRec.size > 0) fs.ftruncateSync(fd, fileRec.size);
  fs.closeSync(fd);

  const writeFd = fs.openSync(resolvedOut, 'r+');
  const downloadStart = Date.now();
  let completedDownloads = 0;
  const errors = [];
  const jobs = chunks.slice().sort((a, b) => a.idx - b.idx);
  const workers = Array.from({ length: cfg.concurrency || 4 }, () => (async () => {
    while (true) {
      const job = jobs.shift();
      if (!job) break;
      try {
        const botCfg = cfg.bots[job.idx % cfg.bots.length];
        await scheduler.schedule({ botId: botCfg.id, channelId: 'download', priority: 1, skipChat: true }, async () => {
          const c = botClient(cfg, botCfg);
          if (!job.telegram_file_id) throw new Error(`Chunk ${job.idx} missing telegram file id`);
          const ct = await c.downloadFile(job.telegram_file_id);
          const iv = Buffer.from(job.iv, 'hex');
          const tag = Buffer.from(job.tag, 'hex');
          const plain = cryptoMod.decryptBuffer(key, iv, tag, ct);
          const chunkSha = cryptoMod.sha256Buffer(plain);
          if (chunkSha !== job.sha256) throw new Error(`Chunk ${job.idx} hash mismatch`);
          const offset = job.idx * fileRec.chunk_size;
          await new Promise((resolve, reject) => {
            fs.write(writeFd, plain, 0, plain.length, offset, (err) => err ? reject(err) : resolve());
          });
          completedDownloads += 1;
          printProgress('download', completedDownloads, chunks.length, downloadStart);
        });
      } catch (e) {
        errors.push(e);
      }
    }
  })());
  await Promise.all(workers);
  fs.closeSync(writeFd);

  if (errors.length) throw errors[0];

  const outSha = await cryptoMod.sha256File(resolvedOut);
  if (outSha !== fileRec.sha256) {
    throw new Error(`Output hash mismatch: ${outSha} != ${fileRec.sha256}`);
  }
  return { outPath: resolvedOut, size: fileRec.size, sha256: outSha };
}

async function updateIndex(ctx, password) {
  const { cfg, db, scheduler } = ctx;
  const globalKey = await deriveMasterKey(cfg, db, password);
  const files = dbm.listFiles(db).filter(f => f.status === 'ready');
  const index = {
    version: 1,
    updatedAt: new Date().toISOString(),
    files: files.map(f => ({
      id: f.id,
      name: f.name,
      size: f.size,
      sha256: f.sha256,
      createdAt: f.created_at,
      manifestChannelId: f.manifest_channel_id,
      manifestMessageId: f.manifest_message_id,
      manifestFileId: f.manifest_telegram_file_id
    }))
  };
  const packed = cryptoMod.encryptJson(globalKey, index);

  const prevIndexMsg = dbm.getMeta(db, 'indexMessageId');
  const prevIndexChannel = dbm.getMeta(db, 'indexChannelId');

  const botCfg = cfg.bots[0];
  const channelCfg = cfg.channels[0];
  const client = botClient(cfg, botCfg);
  const resp = await scheduler.schedule({ botId: botCfg.id, channelId: channelCfg.id, priority: 0 }, async () => {
    return client.sendDocument(channelCfg.id, packed, 'index.enc', 'INDEX');
  });
  const newMsgId = String(resp.message_id);
  const newChannelId = channelCfg.id;
  dbm.setMeta(db, 'indexMessageId', newMsgId);
  dbm.setMeta(db, 'indexChannelId', newChannelId);
  dbm.setMeta(db, 'indexFileId', resp.document ? resp.document.file_id : '');

  if (prevIndexMsg && prevIndexChannel) {
    try {
      const pclient = botClient(cfg, botCfg);
      await pclient.deleteMessage(prevIndexChannel, Number(prevIndexMsg));
    } catch (e) {}
  }
}

async function listFilesCmd(ctx) {
  return dbm.listFiles(ctx.db).filter(f => f.status === 'ready');
}

async function deleteFileCmd(ctx, fileId) {
  const { cfg, db, password } = ctx;
  const fileRec = dbm.getFile(db, fileId);
  if (!fileRec) throw new Error(`Unknown file id: ${fileId}`);
  const chunks = dbm.listChunks(db, fileId);
  const botCfg = cfg.bots[0];
  const client = botClient(cfg, botCfg);
  for (const c of chunks) {
    if (c.channel_id && c.message_id) {
      try { await client.deleteMessage(c.channel_id, Number(c.message_id)); } catch (e) {}
    }
  }
  dbm.deleteFileRows(db, fileId);
  return true;
}

async function verifyFile(ctx, fileId) {
  const tempDir = path.join(ctx.cfg.workDir, 'verify');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${fileId}.verify`);
  try {
    const result = await downloadFile(ctx, fileId, tempPath);
    return { verified: true, ...result };
  } finally {
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
}

async function backupDatabase(ctx, outPath) {
  const dest = outPath ? path.resolve(outPath) : path.join(process.cwd(), 'backups', `drive.db.${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await ctx.db.backup(dest);
  return dest;
}

async function exportBundle(ctx, outPath) {
  const files = dbm.listFiles(ctx.db).filter(f => f.status === 'ready');
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: dbm.listAllFolders(ctx.db),
    files: files.map((f) => ({
      ...f,
      chunks: dbm.listChunks(ctx.db, f.id)
    }))
  };
  const salt = cryptoMod.randomSalt(16);
  const key = await cryptoMod.deriveKey(ctx.password, salt, 310000, 32);
  const packed = cryptoMod.encryptJson(key, data);
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, Buffer.concat([salt, packed]));
  return resolved;
}

async function importBundle(ctx, inPath) {
  const packedRaw = fs.readFileSync(path.resolve(inPath));
  const salt = packedRaw.subarray(0, 16);
  const packed = packedRaw.subarray(16);
  const key = await cryptoMod.deriveKey(ctx.password, salt, 310000, 32);
  const data = cryptoMod.decryptJson(key, packed);
  if (!data || !Array.isArray(data.files)) throw new Error('Invalid bundle');
  if (Array.isArray(data.folders)) {
    for (const folder of data.folders) dbm.upsertFolder(ctx.db, folder);
  }
  for (const f of data.files) {
    dbm.upsertFile(ctx.db, f);
    if (Array.isArray(f.chunks)) {
      for (const c of f.chunks) dbm.upsertChunk(ctx.db, c);
    }
  }
  return data.files.length;
}

async function portablePack(ctx, outDir) {
  const dir = path.resolve(outDir || path.join(process.cwd(), 'telestore-portable'));
  fs.mkdirSync(dir, { recursive: true });
  const dbDest = await backupDatabase(ctx, path.join(dir, 'drive.db'));
  const bundleDest = await exportBundle(ctx, path.join(dir, 'drive-bundle.enc'));
  if (ctx.cfg.configPath && fs.existsSync(ctx.cfg.configPath)) {
    fs.copyFileSync(ctx.cfg.configPath, path.join(dir, 'config.json'));
  }
  const note = `Telegram Drive portable bundle
Generated: ${new Date().toISOString()}

Contains:
- config.json: bot/channel configuration (includes secrets)
- drive.db: local metadata database
- drive-bundle.enc: encrypted metadata bundle for re-import

Restore on another machine:
1. Install Node.js and npm install
2. Copy this folder into the project directory
3. Set DRIVE_KEY to the original key
4. Run: node src/cli.js doctor
5. Run: node src/cli.js verify <fileId>
`;
  fs.writeFileSync(path.join(dir, 'RESTORE.txt'), note);
  return { dir, dbDest, bundleDest };
}

async function cleanupFailed(ctx) {
  const { cfg, db } = ctx;
  const failed = dbm.listFiles(db).filter(f => f.status === 'failed');
  const client = botClient(cfg, cfg.bots[0]);
  for (const f of failed) {
    const chunks = dbm.listChunks(db, f.id);
    for (const c of chunks) {
      if (c.channel_id && c.message_id) {
        try { await client.deleteMessage(c.channel_id, Number(c.message_id)); } catch (e) {}
      }
    }
    dbm.deleteFileRows(db, f.id);
  }
  return failed.map(f => f.id);
}

module.exports = { uploadFile, downloadFile, verifyFile, listFilesCmd, deleteFileCmd, cleanupFailed, backupDatabase, exportBundle, importBundle, portablePack, updateIndex, deriveMasterKey };
