type Entry = {
  k: string;
  v: Uint8Array;
  t: number;
  p?: Entry;
  n?: Entry;
};

class UltraLRUCache {
  private map = new Map<string, Entry>();
  private head?: Entry;
  private tail?: Entry;
  private count = 0;

  hits = 0;
  misses = 0;

  constructor(
    private readonly maxSize = 1000,
    private readonly ttl = 300_000 // 5 minutes
  ) {}

  // Hot path inline: get by key + TTL check + move to front if needed
  get(k: string, now = Date.now()): Uint8Array | undefined {
    const e = this.map.get(k);
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (now - e.t > this.ttl) {
      this._remove(e);
      this.misses++;
      return undefined;
    }
    this.hits++;
    if (e !== this.head) {
      // unlink e
      const p = e.p;
      const n = e.n;
      if (p) p.n = n;
      else this.head = n;
      if (n) n.p = p;
      else this.tail = p;

      // insert front
      e.p = undefined;
      e.n = this.head;
      if (this.head) this.head.p = e;
      this.head = e;
      if (!this.tail) this.tail = e;
    }
    return e.v;
  }

  set(k: string, v: Uint8Array, now = Date.now()): void {
    const e = this.map.get(k);
    if (e) {
      e.v = v;
      e.t = now;
      if (e !== this.head) {
        // unlink e
        const p = e.p;
        const n = e.n;
        if (p) p.n = n;
        else this.head = n;
        if (n) n.p = p;
        else this.tail = p;

        // insert front
        e.p = undefined;
        e.n = this.head;
        if (this.head) this.head.p = e;
        this.head = e;
        if (!this.tail) this.tail = e;
      }
      return;
    }

    // New entry
    const ne: Entry = { k, v, t: now, p: undefined, n: this.head };
    if (this.head) this.head.p = ne;
    this.head = ne;
    if (!this.tail) this.tail = ne;

    this.map.set(k, ne);
    this.count++;

    // Evict tail if over maxSize
    if (this.count > this.maxSize && this.tail) {
      const tail = this.tail;
      this.map.delete(tail.k);
      const p = tail.p;
      if (p) p.n = undefined;
      this.tail = p;
      this.count--;
    }
  }

  // Cleanup only evicts expired tail entries in a tight loop (limit max 100)
  cleanup(now = Date.now(), maxRemove = 100): number {
    let removed = 0;
    let current = this.tail;
    while (current && now - current.t > this.ttl && removed < maxRemove) {
      const p = current.p;
      this.map.delete(current.k);
      if (p) p.n = undefined;
      this.tail = p;
      this.count--;
      removed++;
      current = p;
    }
    return removed;
  }

  reset(): void {
    this.map.clear();
    this.head = undefined;
    this.tail = undefined;
    this.count = this.hits = this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
      count: this.count,
    };
  }
}

// Singleton instance
export const cache = new UltraLRUCache(1000, 300_000);

export const cacheResponse = (k: string, v: Uint8Array, now?: number) =>
  cache.set(k, v, now ?? Date.now());

export const getCachedResponse = (k: string, now?: number) =>
  cache.get(k, now ?? Date.now());

// Auto cleanup throttle
let lastCleanup = 0;
const CLEANUP_INTERVAL = 60_000;

export const getCachedResponseWithCleanup = (k: string): Uint8Array | undefined => {
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    cache.cleanup(now);
    lastCleanup = now;
  }
  return cache.get(k, now);
};
