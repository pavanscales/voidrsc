// framework/cache.ts

type CacheEntry = {
  key: string;
  value: Response;
  timestamp: number; // for TTL expiration
  prev?: CacheEntry;
  next?: CacheEntry;
};

export class LRUCache {
  private maxSize: number;
  private ttl: number; // milliseconds
  private cacheMap: Map<string, CacheEntry>;
  private head?: CacheEntry;
  private tail?: CacheEntry;
  private currentSize: number;

  // Metrics
  public hits = 0;
  public misses = 0;

  // Enable logging on evictions (disable in prod)
  private logEvictions = false;

  constructor(maxSize = 1000, ttl = 1000 * 60 * 5 /*5 mins*/) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cacheMap = new Map();
    this.currentSize = 0;
  }

  get(key: string): Response | undefined {
    const entry = this.cacheMap.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (Date.now() - entry.timestamp > this.ttl) {
      this.evictEntry(entry);
      this.misses++;
      return undefined;
    }

    this.hits++;
    this.moveToHead(entry);
    return entry.value.clone();
  }

  async set(key: string, value: Response): Promise<void> {
    // Clone response body fully to avoid locking issues
    const cloned = value.clone();
    const body = await cloned.text();

    const cachedResponse = new Response(body, {
      status: value.status,
      statusText: value.statusText,
      headers: value.headers,
    });

    let entry = this.cacheMap.get(key);

    if (entry) {
      entry.value = cachedResponse;
      entry.timestamp = Date.now();
      this.moveToHead(entry);
      return;
    }

    entry = {
      key,
      value: cachedResponse,
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
    if (!this.tail) return;
    this.evictEntry(this.tail);
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

  // Utility to toggle eviction logging (for debugging only)
  toggleEvictionLogging(enable: boolean) {
    this.logEvictions = enable;
  }

  // Reset metrics
  resetMetrics() {
    this.hits = 0;
    this.misses = 0;
  }
}

export const cache = new LRUCache(1000, 5 * 60 * 1000); // 1000 max entries, 5 min TTL

// Cache helpers for ease of use

export async function cacheResponse(key: string, res: Response) {
  await cache.set(key, res);
}

export function getCachedResponse(key: string): Response | undefined {
  return cache.get(key);
}
