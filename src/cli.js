const { parseArgs } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, writeTemplate, driveKey } = require('./config');
const { openDb } = require('./db');
const { Scheduler } = require('./scheduler');
const storage = require('./storage');

const cmd = process.argv[2];

function print(obj) { console.log(JSON.stringify(obj, null, 2)); }

function makeCtx(configPath) {
  const cfg = loadConfig(configPath);
  const db = openDb(cfg.dbPath);
  const scheduler = new Scheduler({
    concurrency: cfg.concurrency,
    globalPerSec: cfg.rate.globalPerSecond,
    perChatPerMinute: cfg.rate.perBotChatPerMinute
  });
  const password = driveKey();
  return { cfg, db, scheduler, password };
}

async function main() {
  if (!cmd) {
    console.log('Usage: node src/cli.js <init|upload|download|list|delete|status> ...');
    process.exit(1);
  }

  if (cmd === 'init') {
    const { values } = parseArgs({ options: { config: { type: 'string', default: 'config.json' }, force: { type: 'boolean', default: false } }, allowPositionals: true });
    const p = path.resolve(values.config);
    if (fs.existsSync(p) && !values.force) {
      console.error(`Config already exists: ${p}`);
      console.error('Refusing to overwrite it. Use --force if you really want to replace it.');
      process.exit(1);
    }
    writeTemplate(p);
    console.log('Wrote config template:', p);
    console.log('Set bot tokens/channels, then export DRIVE_KEY and run commands.');
    return;
  }

  if (cmd === 'status') {
    const ctx = makeCtx();
    console.log('bots:', ctx.cfg.bots.map(b => `${b.id} (${b.display})`));
    console.log('channels:', ctx.cfg.channels.map(c => `${c.id} (${c.display})`));
    console.log('db:', ctx.cfg.dbPath);
    console.log('index msg:', require('./db').getMeta ? require('./db').getMeta(ctx.db, 'indexMessageId') : 'n/a');
    return;
  }

  if (cmd === 'upload') {
    const { values, positionals } = parseArgs({
      options: {
        config: { type: 'string', default: 'config.json' },
        verify: { type: 'boolean', default: false },
        fresh: { type: 'boolean', default: false },
        cleanupOnFail: { type: 'boolean', default: false }
      },
      allowPositionals: true
    });
    const file = positionals[1];
    if (!file) { console.error('Usage: upload <file> [--fresh] [--cleanup-on-fail]'); process.exit(1); }
    const ctx = makeCtx(values.config);
    ctx.fresh = values.fresh;
    ctx.cleanupOnFail = values.cleanupOnFail;
    const res = await storage.uploadFile(ctx, path.resolve(file));
    print(res);
    return;
  }

  if (cmd === 'download') {
    const { values, positionals } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const id = positionals[1];
    const out = positionals[2] || null;
    if (!id) { console.error('Usage: download <fileId> [outPath]'); process.exit(1); }
    const ctx = makeCtx(values.config);
    const resolvedOut = out ? path.resolve(out) : null;
    const res = await storage.downloadFile(ctx, id, resolvedOut);
    print(res);
    return;
  }

  if (cmd === 'list') {
    const { values } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const ctx = makeCtx(values.config);
    const dbm = require('./db');
    const rows = await storage.listFilesCmd(ctx);
    console.log('ID\tSTATUS\tSIZE\tCHUNKS\tLOCS\tCREATED\tNAME');
    for (const r of rows) {
      const chunks = dbm.listChunks(ctx.db, r.id);
      const locs = new Set(chunks.map(c => c.channel_id).filter(Boolean)).size;
      const created = (r.created_at || '').replace('T', ' ').slice(0, 19);
      console.log(`${r.id}\t${r.status}\t${r.size}\t${r.num_chunks}\t${locs}\t${created}\t${r.name}`);
    }
    return;
  }

  if (cmd === 'delete') {
    const { values, positionals } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const id = positionals[1];
    if (!id) { console.error('Usage: delete <fileId>'); process.exit(1); }
    const ctx = makeCtx(values.config);
    await storage.deleteFileCmd(ctx, id);
    console.log('deleted', id);
    return;
  }

  if (cmd === 'discover') {
    const { values } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' }, bot: { type: 'string', default: 'b1' }, seconds: { type: 'string', default: '20' } },
      allowPositionals: true
    });
    const cfg = loadConfig(values.config);
    const botCfg = cfg.bots.find(b => b.id === values.bot) || cfg.bots[0];
    const { bot: makeBot } = require('./telegram');
    const client = makeBot(botCfg.token);
    const duration = Math.max(5, Number(values.seconds) || 20);
    const deadline = Date.now() + duration * 1000;
    const chats = new Map();
    let offset = 0;
    console.log(`Polling updates for ${duration}s using bot ${botCfg.id}. Make a test post in each channel first.`);
    while (Date.now() < deadline) {
      const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      const timeout = Math.min(5, remaining);
      let updates = [];
      try {
        updates = await client.getUpdates(offset, 100, timeout);
      } catch (e) {
        console.error('getUpdates error:', e && e.message ? e.message : e);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      if (!Array.isArray(updates) || updates.length === 0) continue;
      console.log(`received ${updates.length} update(s)`);
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        const candidate = u.channel_post || u.edited_channel_post || u.message || u.edited_message || (u.my_chat_member && u.my_chat_member.chat);
        const chat = candidate && candidate.chat ? candidate.chat : null;
        if (chat) {
          chats.set(chat.id, { id: chat.id, type: chat.type, title: chat.title || chat.username || '' });
        }
      }
    }
    console.log('Discovered chats/channels:');
    for (const c of chats.values()) console.log(`${c.id}\t${c.type}\t${c.title}`);
    if (chats.size === 0) {
      console.log('None found. Make a test post in each channel while discovery is running.');
    }
    return;
  }

  if (cmd === 'cleanup') {
    const { values } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const ctx = makeCtx(values.config);
    const removed = await storage.cleanupFailed(ctx);
    console.log('removed failed uploads:', removed.length ? removed.join(', ') : 'none');
    return;
  }

  if (cmd === 'backup') {
    const { values, positionals } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const ctx = makeCtx(values.config);
    const dest = await storage.backupDatabase(ctx, positionals[1] || null);
    console.log('backup saved:', dest);
    return;
  }

  if (cmd === 'export') {
    const { values } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' }, out: { type: 'string' } },
      allowPositionals: true
    });
    if (!values.out) { console.error('Usage: export --out <file>'); process.exit(1); }
    const ctx = makeCtx(values.config);
    const dest = await storage.exportBundle(ctx, values.out);
    console.log('export bundle saved:', dest);
    return;
  }

  if (cmd === 'import') {
    const { values } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' }, in: { type: 'string' } },
      allowPositionals: true
    });
    if (!values.in) { console.error('Usage: import --in <file>'); process.exit(1); }
    const ctx = makeCtx(values.config);
    const count = await storage.importBundle(ctx, values.in);
    console.log(`imported ${count} file record(s)`);
    return;
  }

  if (cmd === 'verify') {
    const { values, positionals } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const id = positionals[1];
    if (!id) { console.error('Usage: verify <fileId>'); process.exit(1); }
    const ctx = makeCtx(values.config);
    const result = await storage.verifyFile(ctx, id);
    print({ verified: true, fileId: id, ...result });
    return;
  }

  if (cmd === 'doctor') {
    const { values } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const keyPresent = Boolean(process.env.DRIVE_KEY);
    console.log(`DRIVE_KEY: ${keyPresent ? 'present' : 'MISSING'}`);
    if (!keyPresent) console.log('  Set it before upload/download: $env:DRIVE_KEY = "..."');

    const cfgPath = path.resolve(values.config);
    if (!fs.existsSync(cfgPath)) {
      console.log('Config:', 'MISSING at ' + cfgPath);
      return;
    }
    const cfg = loadConfig(cfgPath);
    const { bot: makeBot } = require('./telegram');
    console.log('Config: OK');
    console.log('Bots:', cfg.bots.length, '| Channels:', cfg.channels.length);

    for (const b of cfg.bots) {
      let tokenOk = /^\d+:[A-Za-z0-9_-]+$/.test(b.token);
      console.log(`\nBot ${b.id} (${b.display || b.alias}): token format ${tokenOk ? 'OK' : 'SUSPICIOUS'}`);
      if (!tokenOk) continue;
      const client = makeBot(b.token);
      try {
        const me = await client.getMe();
        b._meId = me.id;
        console.log(`  API: OK -> @${me.username || me.first_name} (id ${me.id})`);
      } catch (e) {
        console.log(`  API: FAIL -> ${e && e.message ? e.message : e}`);
      }
    }

    for (const c of cfg.channels) {
      console.log(`\nChannel ${c.id} (${c.display || c.alias})`);
      if (!cfg.bots.length) continue;
      const client = makeBot(cfg.bots[0].token);
      try {
        const chat = await client.getChat(c.id);
        console.log(`  Access: OK -> "${chat.title || chat.username || ''}" (${chat.type})`);
      } catch (e) {
        console.log(`  Access: FAIL -> ${e && e.message ? e.message : e}`);
        continue;
      }
      try {
        const admins = await client.getChatAdministrators(c.id);
        const byId = new Map(cfg.bots.map(b => [null, b]));
        const adminIds = new Set(admins.map(a => a.user && a.user.id));
        const missing = cfg.bots.filter(b => b._meId && !adminIds.has(b._meId));
        if (missing.length === 0) {
          console.log(`  Bot admin status: OK for all ${cfg.bots.length} bot(s)`);
        } else {
          console.log(`  Bot admin status: MISSING for ${missing.map(b => b.id).join(', ')}`);
        }
      } catch (e) {
        console.log(`  Admin check: ${e && e.message ? e.message : e}`);
      }
    }

    try {
      const db = openDb(cfg.dbPath);
      const files = require('./db').listFiles(db).length;
      console.log(`\nDatabase: OK (${files} files)`);
    } catch (e) {
      console.log(`\nDatabase: FAIL -> ${e && e.message ? e.message : e}`);
    }
    return;
  }

  if (cmd === 'portable') {
    const { values, positionals } = parseArgs({
      options: { config: { type: 'string', default: 'config.json' } },
      allowPositionals: true
    });
    const ctx = makeCtx(values.config);
    const outDir = positionals[1] || './telestore-portable';
    const result = await storage.portablePack(ctx, outDir);
    console.log('portable bundle created:', result.dir);
    console.log('contains: config.json, drive.db, drive-bundle.enc, RESTORE.txt');
    return;
  }

  if (cmd === 'download-index') {
    // Debug not implemented
    console.log('not implemented');
    return;
  }

  console.error('Unknown command:', cmd);
  process.exit(1);
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
