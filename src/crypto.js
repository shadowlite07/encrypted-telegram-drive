const crypto = require('node:crypto');
const zlib = require('node:zlib');

function deriveKey(password, salt, iterations = 310000, keylen = 32) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keylen, 'sha256', (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function sha256File(filePath) {
  const fs = require('node:fs');
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function encryptBuffer(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext };
}

function decryptBuffer(key, iv, tag, ciphertext) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptJson(key, obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const { iv, tag, ciphertext } = encryptBuffer(key, json);
  // pack: iv(12) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, ciphertext]);
}

function decryptJson(key, packed) {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const json = decryptBuffer(key, iv, tag, ciphertext);
  return JSON.parse(json.toString('utf8'));
}

function randomSalt(size = 16) { return crypto.randomBytes(size); }
function randomIv() { return crypto.randomBytes(12); }

function gzipIfNeeded(data, enabled) {
  if (!enabled) return { data, compression: 'none' };
  return { data: zlib.gzipSync(data), compression: 'gzip' };
}

function gunzipIfNeeded(data, compression) {
  if (compression === 'gzip') return zlib.gunzipSync(data);
  return data;
}

module.exports = {
  deriveKey, sha256Buffer, sha256File, encryptBuffer, decryptBuffer,
  encryptJson, decryptJson, randomSalt, randomIv, gzipIfNeeded, gunzipIfNeeded
};
