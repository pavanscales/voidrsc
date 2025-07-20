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
    private readonly ttl = 300_000
  ) {}

  get(k: string, now = Date.now()): Uint8Array | undefined {
    const e = this.map.get(k);
    if (!e) return this._miss();

    if (now - e.t > this.ttl) {
      this._remove(e);
      return this._miss();
    }

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
      this._insertFront(e);
      this.count++;

      if (this.count > this.maxSize && this.tail) {
        this._remove(this.tail);
      }
    }
  }

  private _miss(): undefined {
    this.misses++;
    return undefined;
  }

  private _moveToFront(e: Entry): void {
    this._unlink(e);
    this._insertFront(e);
  }

  private _insertFront(e: Entry): void {
    e.n = this.head;
    e.p = undefined;
    if (this.head) this.head.p = e;
    this.head = e;
    if (!this.tail) this.tail = e;
  }

  private _unlink(e: Entry): void {
    if (e.p) e.p.n = e.n;
    else this.head = e.n;

    if (e.n) e.n.p = e.p;
    else this.tail = e.p;
  }

  private _remove(e: Entry): void {
    this.map.delete(e.k);
    this._unlink(e);
    this.count--;
  }

  reset() {
    this.map.clear();
    this.head = this.tail = undefined;
    this.count = this.hits = this.misses = 0;
  }

  logStats() {
    console.log("Hits:", this.hits, "Misses:", this.misses);
  }
}

// 🚀 Fastest possible exposed API
export const cache = new UltraLRUCache(1000, 300_000);
export const cacheResponse = (k: string, v: Uint8Array) => cache.set(k, v);
export const getCachedResponse = (k: string) => cache.get(k);
