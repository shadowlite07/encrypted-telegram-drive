const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = path.join(process.cwd(), 'config.json');

function loadConfig(configPath = process.env.CONFIG_PATH || DEFAULT_PATH) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}. Run "node src/cli.js init" first.`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  cfg.configPath = configPath;
  cfg.baseDir = path.dirname(path.resolve(configPath));
  cfg.chunkSizeBytes = cfg.chunkSizeBytes || (cfg.chunkSizeMB ? cfg.chunkSizeMB * 1024 * 1024 : 16 * 1024 * 1024);
  cfg.concurrency = cfg.concurrency || 4;
  cfg.rate = cfg.rate || {};
  cfg.rate.perBotChatPerMinute = cfg.rate.perBotChatPerMinute || 18;
  cfg.rate.globalPerSecond = cfg.rate.globalPerSecond || 25;
  cfg.dbPath = path.resolve(cfg.baseDir, cfg.dbPath || './data/drive.db');
  cfg.workDir = path.resolve(cfg.baseDir, cfg.workDir || './.chunks');
  if (!Array.isArray(cfg.bots) || !cfg.bots.length) throw new Error('config.bots must be a non-empty array');
  if (!Array.isArray(cfg.channels) || !cfg.channels.length) throw new Error('config.channels must be a non-empty array');
  for (const b of cfg.bots) { b.alias = b.alias || b.id; b.display = b.display || b.alias; if (!b.token) throw new Error(`Bot ${b.id} missing token`); }
  for (const c of cfg.channels) { c.alias = c.alias || c.id; c.display = c.display || c.alias; }
  return cfg;
}

function writeTemplate(configPath = DEFAULT_PATH) {
  const template = {
    bots: [
      { id: 'b1', alias: 'bot1', display: 'Vault Bot 1', token: '123456:ABC-REPLACE' }
    ],
    channels: [
      { id: '-100REPLACE', alias: 'drive1', display: 'Vault Channel 1' }
    ],
    chunkSizeBytes: 16 * 1024 * 1024,
    concurrency: 4,
    rate: { perBotChatPerMinute: 18, globalPerSecond: 25 },
    dbPath: './data/drive.db',
    workDir: './.chunks'
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(template, null, 2));
  return configPath;
}

function driveKey() {
  const k = process.env.DRIVE_KEY;
  if (!k) throw new Error('DRIVE_KEY environment variable is required');
  return k;
}

module.exports = { loadConfig, writeTemplate, driveKey, DEFAULT_PATH };
