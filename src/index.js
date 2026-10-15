const dbm = require('./db');
const configMod = require('./config');
const storage = require('./storage');
const { Scheduler } = require('./scheduler');

function resolveConfig(config) {
  if (typeof config === 'string') return configMod.loadConfig(config);
  if (!config || typeof config !== 'object') throw new Error('config must be an object or file path');
  return config;
}

function normalizeFolderId(folderId) {
  if (folderId === undefined || folderId === 'root' || folderId === null) return null;
  return folderId;
}

class TelegramDrive {
  constructor(config, driveKey, options = {}) {
    this.config = resolveConfig(config);
    this.password = driveKey || process.env.DRIVE_KEY;
    if (!this.password) throw new Error('DRIVE_KEY is required');
    this.options = options;
    this.db = dbm.openDb(this.config.dbPath);
    this.scheduler = new Scheduler({
      concurrency: this.config.concurrency,
      globalPerSec: this.config.rate && this.config.rate.globalPerSecond,
      perChatPerMinute: this.config.rate && this.config.rate.perBotChatPerMinute
    });
    this.ctx = {
      cfg: this.config,
      db: this.db,
      scheduler: this.scheduler,
      password: this.password,
      quiet: options.quiet !== false
    };
    this._bound = new WeakMap();
  }

  folders = {
    list: async (parent = null, recursive = false) => {
      const dbm = require('./db');
      const pid = parent && parent !== 'root' ? parent : null;
      return dbm.listFolders(this.db, pid);
    },

    create: async (name, options = {}) => {
      const dbm = require('./db');
      const folder = {
        id: require('node:crypto').randomUUID(),
        name,
        parent_id: normalizeFolderId(options.parent || options.parentId),
        created_at: new Date().toISOString(),
        status: 'active'
      };
      dbm.createFolder(this.db, folder);
      return folder;
    },

    rename: async (id, name) => {
      const dbm = require('./db');
      dbm.renameFolder(this.db, id, name);
      return dbm.getFolder(this.db, id);
    },

    delete: async (id) => {
      const dbm = require('./db');
      dbm.deleteFolder(this.db, id);
      return true;
    },

    get: async (id) => {
      const dbm = require('./db');
      return dbm.getFolder(this.db, id);
    }
  };

  files = {
    upload: async (filePath, options = {}) => {
      const opCtx = {
        ...this.ctx,
        folderId: normalizeFolderId(options.folderId || options.folder),
        fresh: Boolean(options.fresh),
        cleanupOnFail: Boolean(options.cleanupOnFail),
        onProgress: options.onProgress
      };
      return storage.uploadFile(opCtx, filePath, options);
    },

    download: async (fileId, outPath, options = {}) => {
      const opCtx = { ...this.ctx, onProgress: options.onProgress };
      return storage.downloadFile(opCtx, fileId, outPath);
    },

    move: async (fileId, folderId) => {
      const dbm = require('./db');
      const target = normalizeFolderId(folderId);
      if (target) {
        const folder = dbm.getFolder(this.db, target);
        if (!folder) throw new Error(`Folder not found: ${target}`);
      }
      dbm.moveFileToFolder(this.db, fileId, target);
      return dbm.getFile(this.db, fileId);
    },

    list: async (options = {}) => {
      const dbm = require('./db');
      if (options.all) return await storage.listFilesCmd(this.ctx);
      const folderId = normalizeFolderId(options.folderId || options.folder);
      return dbm.listFilesInFolder(this.db, folderId, Boolean(options.recursive))
        .filter((f) => f.status === 'ready');
    },

    get: async (fileId) => {
      const dbm = require('./db');
      return dbm.getFile(this.db, fileId);
    },

    verify: async (fileId, options = {}) => {
      const opCtx = { ...this.ctx, onProgress: options.onProgress };
      return storage.verifyFile(opCtx, fileId);
    },

    delete: async (fileId) => {
      return storage.deleteFileCmd(this.ctx, fileId);
    }
  };

  async cleanupFailed() {
    return storage.cleanupFailed(this.ctx);
  }

  async backup(outPath) {
    return storage.backupDatabase(this.ctx, outPath);
  }

  async exportBundle(outPath) {
    return storage.exportBundle(this.ctx, outPath);
  }

  async importBundle(inPath) {
    return storage.importBundle(this.ctx, inPath);
  }

  async portable(outDir) {
    return storage.portablePack(this.ctx, outDir);
  }

  async doctor() {
    const cfg = this.config;
    const { bot: makeBot } = require('./telegram');
    const results = {
      driveKey: Boolean(this.password),
      bots: [],
      channels: [],
      database: null
    };

    for (const b of cfg.bots) {
      const client = makeBot(b.token);
      try {
        const me = await client.getMe();
        results.bots.push({ id: b.id, ok: true, username: me.username || me.first_name, userId: me.id });
      } catch (e) {
        results.bots.push({ id: b.id, ok: false, error: e && e.message ? e.message : String(e) });
      }
    }

    for (const c of cfg.channels) {
      const client = makeBot(cfg.bots.length ? cfg.bots[0].token : '');
      let result = { id: c.id, ok: false, error: 'No bot configured' };
      if (cfg.bots.length) {
        try {
          const chat = await client.getChat(c.id);
          result = { id: c.id, ok: true, title: chat.title || chat.username || '', type: chat.type };
        } catch (e) {
          result = { id: c.id, ok: false, error: e && e.message ? e.message : String(e) };
        }
      }
      results.channels.push(result);
    }

    try {
      const files = require('./db').listFiles(this.db).length;
      results.database = { ok: true, files };
    } catch (e) {
      results.database = { ok: false, error: e && e.message ? e.message : String(e) };
    }

    return results;
  }

  close() {
    try { this.db.close(); } catch (e) {}
  }
}

function createDrive(config, driveKey, options) {
  return new TelegramDrive(config, driveKey, options);
}

module.exports = {
  TelegramDrive,
  createDrive,
  createTelegramDrive: createDrive,
  loadConfig: configMod.loadConfig
};