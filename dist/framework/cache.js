// framework/cache.ts
export class LRUCache {
    maxSize;
    ttl; // milliseconds
    cacheMap;
    head;
    tail;
    currentSize;
    // Metrics
    hits = 0;
    misses = 0;
    // Enable logging on evictions (disable in prod)
    logEvictions = false;
    constructor(maxSize = 1000, ttl = 1000 * 60 * 5 /*5 mins*/) {
        this.maxSize = maxSize;
        this.ttl = ttl;
        this.cacheMap = new Map();
        this.currentSize = 0;
    }
    get(key) {
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
    async set(key, value) {
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
    evictEntry(entry) {
        this.cacheMap.delete(entry.key);
        this.removeEntry(entry);
        this.currentSize--;
        if (this.logEvictions) {
            console.log(`🗑️ Cache evicted key: ${entry.key}`);
        }
    }
    evictTail() {
        if (!this.tail)
            return;
        this.evictEntry(this.tail);
    }
    moveToHead(entry) {
        if (entry === this.head)
            return;
        this.removeEntry(entry);
        this.addToHead(entry);
    }
    addToHead(entry) {
        entry.next = this.head;
        entry.prev = undefined;
        if (this.head)
            this.head.prev = entry;
        this.head = entry;
        if (!this.tail)
            this.tail = entry;
    }
    removeEntry(entry) {
        if (entry.prev)
            entry.prev.next = entry.next;
        else
            this.head = entry.next;
        if (entry.next)
            entry.next.prev = entry.prev;
        else
            this.tail = entry.prev;
    }
    // Utility to toggle eviction logging (for debugging only)
    toggleEvictionLogging(enable) {
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
export async function cacheResponse(key, res) {
    await cache.set(key, res);
}
export function getCachedResponse(key) {
    return cache.get(key);
}
