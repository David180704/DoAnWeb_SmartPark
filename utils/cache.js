const DEFAULT_TTL_MS = Number(process.env.CACHE_TTL_MS) || 20000;

class TTLCache {
    constructor(ttlMs = DEFAULT_TTL_MS) {
        this.ttlMs = ttlMs;
        this.store = new Map();
    }

    async getOrSet(key, fetchFn) {
        const entry = this.store.get(key);
        const now = Date.now();
        if (entry && now - entry.timestamp < this.ttlMs) {
            return entry.value;
        }
        const value = await fetchFn();
        this.store.set(key, { value, timestamp: now });
        return value;
    }

    invalidate(key) {
        if (key) {
            this.store.delete(key);
        } else {
            this.store.clear();
        }
    }
}

module.exports = { TTLCache, DEFAULT_TTL_MS };
