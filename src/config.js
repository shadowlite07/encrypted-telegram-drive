const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = path.join(process.cwd(), 'config.json');

function loadEnv(baseDir) {
  const envPath = path.join(baseDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function resolveEnvVars(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] || '');
  }
  if (Array.isArray(value)) return value.map(resolveEnvVars);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnvVars(v)]));
  }
  return value;
}

function loadConfig(configPath = process.env.CONFIG_PATH || DEFAULT_PATH) {
  const resolvedPath = path.resolve(configPath);
  const baseDir = path.dirname(resolvedPath);
  loadEnv(baseDir);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config not found: ${resolvedPath}. Run "node src/cli.js init" first.`);
  }
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const cfg = resolveEnvVars(JSON.parse(raw));
  cfg.configPath = resolvedPath;
  cfg.baseDir = baseDir;
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

  const envExample = path.join(path.dirname(configPath), '.env.example');
  fs.writeFileSync(envExample, [
    '# Telegram drive secrets',
    'BOT1_TOKEN=123456:ABC-REPLACE',
    'DRIVE_CHANNEL_ID=-100REPLACE',
    'DRIVE_KEY=replace-with-a-long-base64-key',
    ''
  ].join('\\n'));

  const configExample = path.join(path.dirname(configPath), 'config.example.json');
  const envTemplate = {
    bots: [
      { id: 'b1', alias: 'bot1', display: 'Vault Bot 1', token: '${BOT1_TOKEN}' }
    ],
    channels: [
      { id: '${DRIVE_CHANNEL_ID}', alias: 'drive1', display: 'Vault Channel 1' }
    ],
    chunkSizeBytes: 16 * 1024 * 1024,
    concurrency: 4,
    rate: { perBotChatPerMinute: 18, globalPerSecond: 25 },
    dbPath: './data/drive.db',
    workDir: './.chunks'
  };
  fs.writeFileSync(configExample, JSON.stringify(envTemplate, null, 2));
  return configPath;
}

function driveKey() {
  const k = process.env.DRIVE_KEY;
  if (!k) throw new Error('DRIVE_KEY environment variable is required');
  return k;
}

module.exports = { loadConfig, writeTemplate, driveKey, DEFAULT_PATH };
