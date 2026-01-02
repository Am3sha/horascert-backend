/**
 * Simple in-memory LRU cache for certificate verification
 * TTL: 5 minutes
 * Max items: 1000
 */

class LRUCache {
    constructor(maxSize = 1000, ttlMs = 5 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    set(key, value) {
        // Delete if exists (to move to end)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Add with timestamp
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });

        // Remove oldest item if size exceeded
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        // Check if expired
        if (Date.now() - item.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return null;
        }

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, item);

        return item.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    size() {
        return this.cache.size;
    }

    stats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            ttlMs: this.ttlMs
        };
    }
}

// Create singleton instance for certificate cache
const certificateCache = new LRUCache(500, 5 * 60 * 1000); // 500 items, 5 min TTL

module.exports = {
    LRUCache,
    certificateCache
};
