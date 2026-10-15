const test = require('node:test');
const assert = require('node:assert');
const crypto = require('../src/crypto');

test('crypto: encrypt/decrypt round trip', async () => {
  const key = await crypto.deriveKey('test-password', Buffer.from('0123456789abcdef', 'hex'), 1000, 32);
  const packed = crypto.encryptJson(key, { a: 'hello', n: 42 });
  const parsed = crypto.decryptJson(key, packed);
  assert.deepEqual(parsed, { a: 'hello', n: 42 });
});

test('crypto: decrypt detects tampering', async () => {
  const key = await crypto.deriveKey('test-password', Buffer.from('0123456789abcdef', 'hex'), 1000, 32);
  const packed = Buffer.from(crypto.encryptJson(key, { value: 1 }));
  packed[packed.length - 1] ^= 1;
  assert.throws(() => crypto.decryptJson(key, packed));
});

test('crypto: sha256Buffer matches known value', () => {
  assert.strictEqual(
    crypto.sha256Buffer(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});
