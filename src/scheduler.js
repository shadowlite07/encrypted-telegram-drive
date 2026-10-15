class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.last = Date.now();
  }
  async acquire(cost = 1) {
    while (true) {
      const now = Date.now();
      const elapsed = (now - this.last) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
      this.last = now;
      if (this.tokens >= cost) { this.tokens -= cost; return; }
      const waitMs = ((cost - this.tokens) / this.refillPerSec) * 1000;
      await new Promise(r => setTimeout(r, Math.max(10, waitMs)));
    }
  }
}

class Scheduler {
  constructor({ concurrency, globalPerSec, perChatPerMinute }) {
    this.concurrency = concurrency || 4;
    this.globalBucket = new TokenBucket(globalPerSec || 25, globalPerSec || 25);
    this.perChatCapacity = perChatPerMinute || 18;
    this.perChatRefill = (perChatPerMinute || 18) / 60;
    this.chatBuckets = new Map();
    this.queue = [];
    this.running = 0;
    // max concurrency guard
  }
  chatBucket(key) {
    if (!this.chatBuckets.has(key)) {
      this.chatBuckets.set(key, new TokenBucket(this.perChatCapacity, this.perChatRefill));
    }
    return this.chatBuckets.get(key);
  }
  schedule(meta, fn, priority = 5) {
    return new Promise((resolve, reject) => {
      this.queue.push({ meta, fn, priority, resolve, reject, ts: Date.now() });
      this.queue.sort((a, b) => a.priority - b.priority || a.ts - b.ts);
      this.pump();
    });
  }
  pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.running++;
      (async () => {
        try {
          const { botId, channelId, skipChat } = job.meta;
          await this.globalBucket.acquire(1);
          if (!skipChat) {
            const ck = `bot:${botId}:chat:${channelId}`;
            await this.chatBucket(ck).acquire(1);
          }
          const res = await job.fn();
          job.resolve(res);
        } catch (e) {
          job.reject(e);
        } finally {
          this.running--;
          this.pump();
        }
      })();
    }
  }
}

module.exports = { Scheduler, TokenBucket };
