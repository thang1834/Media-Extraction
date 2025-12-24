/**
 * Simple LRU Cache Implementation
 * 
 * A lightweight LRU (Least Recently Used) cache with TTL support.
 * Used for caching frequently accessed data to improve performance.
 * 
 * Features:
 * - Maximum size limit
 * - TTL (Time To Live) support
 * - Automatic cleanup of expired entries
 * - LRU eviction when cache is full
 */

/**
 * LRU Cache class
 * 
 * @template T
 */
export class LRUCache {
    /**
     * @param {Object} options - Cache options
     * @param {number} options.max - Maximum number of entries (default: 1000)
     * @param {number} options.ttl - Time to live in milliseconds (default: 0 = no expiration)
     */
    constructor({ max = 1000, ttl = 0 } = {}) {
        this.max = max;
        this.ttl = ttl;
        this.cache = new Map();
        this.accessOrder = new Map(); // Track access order for LRU
        this.accessCounter = 0;
    }

    /**
     * Get value from cache
     * 
     * @param {string} key - Cache key
     * @returns {T|undefined} Cached value or undefined if not found/expired
     */
    get(key) {
        const entry = this.cache.get(key);
        
        if (!entry) {
            return undefined;
        }

        // Check if entry has expired
        if (this.ttl > 0 && entry.expiresAt && Date.now() > entry.expiresAt) {
            this.delete(key);
            return undefined;
        }

        // Update access order (LRU)
        this.accessOrder.set(key, ++this.accessCounter);
        
        return entry.value;
    }

    /**
     * Set value in cache
     * 
     * @param {string} key - Cache key
     * @param {T} value - Value to cache
     * @param {number} ttl - Optional TTL override in milliseconds
     */
    set(key, value, ttl = null) {
        // Remove oldest entry if cache is full
        if (this.cache.size >= this.max && !this.cache.has(key)) {
            this.evictLRU();
        }

        const expiresAt = ttl !== null 
            ? Date.now() + ttl 
            : (this.ttl > 0 ? Date.now() + this.ttl : null);

        this.cache.set(key, {
            value,
            expiresAt
        });
        
        // Update access order
        this.accessOrder.set(key, ++this.accessCounter);
    }

    /**
     * Check if key exists in cache
     * 
     * @param {string} key - Cache key
     * @returns {boolean} True if key exists and not expired
     */
    has(key) {
        const entry = this.cache.get(key);
        
        if (!entry) {
            return false;
        }

        // Check expiration
        if (this.ttl > 0 && entry.expiresAt && Date.now() > entry.expiresAt) {
            this.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete entry from cache
     * 
     * @param {string} key - Cache key
     * @returns {boolean} True if entry was deleted
     */
    delete(key) {
        this.accessOrder.delete(key);
        return this.cache.delete(key);
    }

    /**
     * Clear all entries from cache
     */
    clear() {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;
    }

    /**
     * Get cache size
     * 
     * @returns {number} Number of entries in cache
     */
    get size() {
        return this.cache.size;
    }

    /**
     * Evict least recently used entry
     * 
     * @private
     */
    evictLRU() {
        if (this.accessOrder.size === 0) {
            // Fallback: remove first entry if access order is empty
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.delete(firstKey);
            }
            return;
        }

        // Find key with lowest access counter (least recently used)
        let lruKey = null;
        let minAccess = Infinity;

        for (const [key, access] of this.accessOrder.entries()) {
            if (access < minAccess) {
                minAccess = access;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.delete(lruKey);
        }
    }

    /**
     * Cleanup expired entries
     * 
     * @returns {number} Number of entries cleaned up
     */
    cleanup() {
        if (this.ttl === 0) {
            return 0; // No TTL, nothing to clean
        }

        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt && now > entry.expiresAt) {
                this.delete(key);
                cleaned++;
            }
        }

        return cleaned;
    }
}

