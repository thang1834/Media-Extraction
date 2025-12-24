/**
 * Configuration Validator
 * 
 * Validates configuration values at startup to fail fast
 * if there are any misconfigurations.
 */

import { logger } from './logger.js';
import { isURL } from '../misc/utils.js';

/**
 * Validate configuration
 * 
 * @param {Object} config - Configuration object
 * @returns {Array<string>} Array of validation errors (empty if valid)
 */
export function validateConfig(config) {
    const errors = [];

    // Validate API URL
    if (!config.apiURL) {
        errors.push('API_URL is required');
    } else {
        try {
            new URL(config.apiURL);
        } catch {
            errors.push('API_URL must be a valid URL');
        }
    }

    // Validate port
    if (config.apiPort && (config.apiPort < 1 || config.apiPort > 65535)) {
        errors.push('API_PORT must be between 1 and 65535');
    }

    // Validate rate limits
    if (config.rateLimitWindow && config.rateLimitWindow < 1) {
        errors.push('RATELIMIT_WINDOW must be at least 1 second');
    }

    if (config.rateLimitMax && config.rateLimitMax < 1) {
        errors.push('RATELIMIT_MAX must be at least 1');
    }

    // Validate timeout
    if (config.requestTimeout && config.requestTimeout < 1000) {
        errors.push('REQUEST_TIMEOUT must be at least 1000ms (1 second)');
    }

    if (config.requestTimeout && config.requestTimeout > 300000) {
        errors.push('REQUEST_TIMEOUT should not exceed 300000ms (5 minutes)');
    }

    // Validate duration limit
    if (config.durationLimit && config.durationLimit < 1) {
        errors.push('DURATION_LIMIT must be at least 1 second');
    }

    // Validate stream lifespan
    if (config.streamLifespan && config.streamLifespan < 1) {
        errors.push('TUNNEL_LIFESPAN must be at least 1 second');
    }

    // Validate Redis URL if provided
    if (config.redisURL) {
        try {
            new URL(config.redisURL);
        } catch {
            errors.push('API_REDIS_URL must be a valid URL');
        }
    }

    // Validate API Key URL if provided
    if (config.apiKeyURL) {
        try {
            new URL(config.apiKeyURL);
        } catch {
            errors.push('API_KEY_URL must be a valid URL');
        }
    }

    // Validate JWT secret if session is enabled
    if (config.sessionEnabled) {
        if (!config.jwtSecret || config.jwtSecret.length < 16) {
            errors.push('JWT_SECRET must be at least 16 characters when session is enabled');
        }
    }

    // Validate instance count
    if (config.instanceCount && config.instanceCount < 1) {
        errors.push('API_INSTANCE_COUNT must be at least 1');
    }

    if (config.instanceCount > 1 && !config.redisURL) {
        errors.push('API_REDIS_URL is required when API_INSTANCE_COUNT > 1');
    }

    // Validate CORS configuration
    if (!config.corsWildcard && !config.corsURL) {
        errors.push('Either CORS_WILDCARD=1 or CORS_URL must be set');
    }

    if (config.corsURL && !isURL(config.corsURL)) {
        errors.push('CORS_URL must be a valid URL');
    }

    // Validate cookie path if provided
    if (config.cookiePath) {
        // Just check if it's a non-empty string
        // Actual path validation would require filesystem access
        if (typeof config.cookiePath !== 'string' || config.cookiePath.trim() === '') {
            errors.push('COOKIE_PATH must be a non-empty string');
        }
    }

    // Validate freebind CIDR if provided
    if (config.freebindCIDR) {
        // Basic CIDR validation (format: x.x.x.x/y or xxxx:xxxx::/y)
        const cidrRegex = /^([0-9a-fA-F:.]+)\/([0-9]{1,3})$/;
        if (!cidrRegex.test(config.freebindCIDR)) {
            errors.push('FREEBIND_CIDR must be a valid CIDR notation (e.g., 192.168.1.0/24)');
        }
    }

    return errors;
}

/**
 * Validate and log configuration
 * 
 * @param {Object} config - Configuration object
 * @throws {Error} If configuration is invalid
 */
export function validateAndLogConfig(config) {
    const errors = validateConfig(config);

    if (errors.length > 0) {
        logger.error({
            errors,
            errorCount: errors.length,
        }, 'Configuration validation failed');
        
        throw new Error(`Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }

    // Configuration validated - details will be shown in startup summary
    // No need to log here to avoid duplicate information
}

