const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

const cryptoMod = require('node:crypto');

class TelegramError extends Error {
  constructor(message, meta) { super(message); this.meta = meta || {}; }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function request(token, method, params = {}, files = {}) {
  const url = `${API_BASE}/bot${token}/${method}`;
  // retry
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res;
    let body;
    try {
      if (Object.keys(files).length) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) fd.append(k, String(v));
        }
        for (const [k, f] of Object.entries(files)) {
          const ab = f.data instanceof ArrayBuffer ? f.data : f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
          const blob = new Blob([ab], { type: f.type || 'application/octet-stream' });
          fd.append(k, blob, f.name || 'file.bin');
        }
        res = await fetch(url, { method: 'POST', body: fd });
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params)
        });
      }
      body = await res.json();
    } catch (e) {
      if (attempt < maxAttempts - 1) { await sleep(1000 * (attempt + 1)); continue; }
      throw e;
    }
    if (body && body.ok) return body.result;
    const desc = body && body.description ? body.description : `HTTP ${res.status}`;
    const retryAfter = body && body.parameters && body.parameters.retry_after;
    const status = res.status;
    if (status === 429 || (retryAfter && retryAfter > 0)) {
      const wait = ((retryAfter || 5) + Math.random() * 1) * 1000;
      if (attempt < maxAttempts - 1) { await sleep(wait); continue; }
    }
    if (status >= 500 && attempt < maxAttempts - 1) {
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new TelegramError(desc, { status, body, method });
  }
  throw new Error('exhausted retries: ' + method);
}

function bot(token) {
  return {
    token,
    getMe: () => request(token, 'getMe'),
    sendDocument: (chatId, data, filename, caption) =>
      request(token, 'sendDocument', { chat_id: chatId, caption }, { document: { data, name: filename, type: 'application/octet-stream' } }),
    getFile: (fileId) => request(token, 'getFile', { file_id: fileId }),
    deleteMessage: (chatId, messageId) => request(token, 'deleteMessage', { chat_id: chatId, message_id: messageId }),
    getChat: (chatId) => request(token, 'getChat', { chat_id: chatId }),
    getChatAdministrators: (chatId) => request(token, 'getChatAdministrators', { chat_id: chatId }),
    getUpdates: (offset = 0, limit = 100, timeout = 5) =>
      request(token, 'getUpdates', { offset, limit, timeout, allowed_updates: ['message', 'channel_post', 'edited_channel_post', 'my_chat_member'] }),
    downloadFile: async (fileId) => {
      const info = await request(token, 'getFile', { file_id: fileId });
      const filePath = info.file_path;
      const url = `${API_BASE}/file/bot${token}/${filePath}`;
      const res = await fetch(url);
      if (!res.ok) throw new TelegramError(`download failed HTTP ${res.status}`, { status: res.status });
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
  };
}

module.exports = { request, bot, TelegramError, sleep };
