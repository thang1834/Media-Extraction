/**
 * Health Check Utilities
 * 
 * Provides health check functions for monitoring API status,
 * dependencies, and system resources.
 */

import { env } from '../config.js';
import Store from '../store/store.js';

/**
 * Check Redis connectivity (if configured)
 * 
 * @returns {Promise<{status: string, latency?: number}>}
 */
async function checkRedis() {
    if (!env.redisURL) {
        return { status: 'not_configured' };
    }

    try {
        const startTime = Date.now();
        const store = new Store('health_check');
        
        // Try to set and get a test value
        const testKey = `health_${Date.now()}`;
        await store.set(testKey, 'ok', 10); // 10 second TTL
        const value = await store.get(testKey);
        await store.delete(testKey);
        
        const latency = Date.now() - startTime;
        
        if (value === 'ok') {
            return { status: 'healthy', latency };
        } else {
            return { status: 'unhealthy', latency };
        }
    } catch (error) {
        return { status: 'error', error: error.message };
    }
}

/**
 * Get system memory usage
 * 
 * @returns {Object} Memory usage statistics
 */
function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        rss: Math.round(usage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
        external: Math.round(usage.external / 1024 / 1024), // MB
    };
}

/**
 * Get server uptime
 * 
 * @param {number} startTime - Server start timestamp
 * @returns {Object} Uptime information
 */
function getUptime(startTime) {
    const uptimeMs = Date.now() - startTime;
    return {
        seconds: Math.floor(uptimeMs / 1000),
        minutes: Math.floor(uptimeMs / 60000),
        hours: Math.floor(uptimeMs / 3600000),
        days: Math.floor(uptimeMs / 86400000),
        formatted: formatUptime(uptimeMs),
    };
}

/**
 * Format uptime as human-readable string
 * 
 * @param {number} ms - Uptime in milliseconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Generate health check response
 * 
 * @param {number} startTime - Server start timestamp
 * @param {boolean} detailed - Include detailed information
 * @returns {Promise<Object>} Health check response
 */
export async function getHealthStatus(startTime, detailed = false) {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: getUptime(startTime),
        memory: getMemoryUsage(),
    };

    // Add Redis status if configured
    if (env.redisURL || detailed) {
        health.redis = await checkRedis();
        
        // If Redis is configured but unhealthy, mark overall status as degraded
        if (env.redisURL && health.redis.status !== 'healthy') {
            health.status = 'degraded';
        }
    }

    // Add detailed information if requested
    if (detailed) {
        health.version = process.version;
        health.platform = process.platform;
        health.arch = process.arch;
        health.pid = process.pid;
        health.enabledServices = [...env.enabledServices];
    }

    return health;
}

