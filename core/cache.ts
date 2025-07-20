type Entry = {
  k: string;
  v: Uint8Array;
  t: number;
  p?: Entry;
  n?: Entry;
};

class FastLRUCache {
  private map = new Map<string, Entry>();
  private head?: Entry;
  private tail?: Entry;
  private count = 0;
  private log = false;

  hits = 0;
  misses = 0;

  constructor(
    private readonly maxSize = 1000,
    private readonly ttl = 300_000
  ) {}

  get(k: string, now = Date.now()): Uint8Array | undefined {
    const e = this.map.get(k);
    if (!e) return this._miss();

    if (now - e.t > this.ttl) return this._expire(e);

    this.hits++;
    if (e !== this.head) this._moveToFront(e);
    return e.v;
  }

  set(k: string, v: Uint8Array, now = Date.now()): void {
    let e = this.map.get(k);

    if (e) {
      e.v = v;
      e.t = now;
      if (e !== this.head) this._moveToFront(e);
    } else {
      e = { k, v, t: now };
      this.map.set(k, e);
      this._insertAtFront(e);
      if (++this.count > this.maxSize) this._evictTail();
    }
  }

  private _moveToFront(e: Entry) {
    // No null checks — trust internal correctness
    const { p, n } = e;
    if (p) p.n = n;
    else this.head = n;
    if (n) n.p = p;
    else this.tail = p;

    e.p = undefined;
    e.n = this.head;
    if (this.head) this.head.p = e;
    this.head = e;
    if (!this.tail) this.tail = e;
  }

  private _insertAtFront(e: Entry) {
    e.p = undefined;
    e.n = this.head;
    if (this.head) this.head.p = e;
    this.head = e;
    if (!this.tail) this.tail = e;
  }

  private _evictTail() {
    if (this.tail) this._evict(this.tail);
  }

  private _evict(e: Entry) {
    this.map.delete(e.k);
    const { p, n } = e;
    if (p) p.n = n;
    else this.head = n;
    if (n) n.p = p;
    else this.tail = p;
    this.count--;
    if (this.log) console.log("🗑️ Evicted:", e.k);
  }

  private _expire(e: Entry): undefined {
    this._evict(e);
    this.misses++;
    return;
  }

  private _miss(): undefined {
    this.misses++;
    return;
  }

  toggleLogs(enable: boolean) {
    this.log = enable;
  }

  resetMetrics() {
    this.hits = 0;
    this.misses = 0;
  }
}

// Public API
export const cache = new FastLRUCache();
export const cacheResponse = cache.set.bind(cache);
export const getCachedResponse = cache.get.bind(cache);
