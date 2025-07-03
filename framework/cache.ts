type CacheEntry = {
  key: string;
  value: Uint8Array;
  timestamp: number;
  prev?: CacheEntry;
  next?: CacheEntry;
};

export class LRUCache {
  private maxSize: number;
  private ttl: number;
  private cacheMap: Map<string, CacheEntry>;
  private head?: CacheEntry;
  private tail?: CacheEntry;
  private currentSize: number;

  public hits = 0;
  public misses = 0;
  private logEvictions = false;

  constructor(maxSize = 1000, ttl = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cacheMap = new Map();
    this.currentSize = 0;
  }

  get(key: string): Uint8Array | undefined {
    const entry = this.cacheMap.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttl) {
      this.evictEntry(entry);
      this.misses++;
      return undefined;
    }

    this.hits++;
    this.moveToHead(entry);
    return entry.value;
  }

  async set(key: string, data: Uint8Array): Promise<void> {
    let entry = this.cacheMap.get(key);

    if (entry) {
      entry.value = data;
      entry.timestamp = Date.now();
      this.moveToHead(entry);
      return;
    }

    entry = {
      key,
      value: data,
      timestamp: Date.now(),
    };

    this.cacheMap.set(key, entry);
    this.addToHead(entry);
    this.currentSize++;

    if (this.currentSize > this.maxSize) {
      this.evictTail();
    }
  }

  private evictEntry(entry: CacheEntry) {
    this.cacheMap.delete(entry.key);
    this.removeEntry(entry);
    this.currentSize--;
    if (this.logEvictions) {
      console.log(`🗑️ Cache evicted key: ${entry.key}`);
    }
  }

  private evictTail() {
    if (this.tail) {
      this.evictEntry(this.tail);
    }
  }

  private moveToHead(entry: CacheEntry) {
    if (entry === this.head) return;
    this.removeEntry(entry);
    this.addToHead(entry);
  }

  private addToHead(entry: CacheEntry) {
    entry.next = this.head;
    entry.prev = undefined;
    if (this.head) this.head.prev = entry;
    this.head = entry;
    if (!this.tail) this.tail = entry;
  }

  private removeEntry(entry: CacheEntry) {
    if (entry.prev) entry.prev.next = entry.next;
    else this.head = entry.next;

    if (entry.next) entry.next.prev = entry.prev;
    else this.tail = entry.prev;
  }

  toggleEvictionLogging(enable: boolean) {
    this.logEvictions = enable;
  }

  resetMetrics() {
    this.hits = 0;
    this.misses = 0;
  }
}

// ✅ Singleton cache instance
export const cache = new LRUCache(1000, 5 * 60 * 1000);

// ✅ Helper methods
export async function cacheResponse(key: string, data: Uint8Array) {
  await cache.set(key, data);
}

export function getCachedResponse(key: string): Uint8Array | undefined {
  return cache.get(key);
}
