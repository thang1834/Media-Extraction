/**
 * Request Timeout Utility
 * 
 * Provides request timeout middleware to prevent long-running requests
 * from consuming server resources.
 */

import { logger } from './logger.js';

/**
 * Request timeout middleware
 * 
 * Sets a timeout for requests and returns 504 Gateway Timeout if exceeded.
 * 
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Function} Express middleware
 */
export function requestTimeout(timeoutMs = 30000) {
    return (req, res, next) => {
        // Set timeout
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                logger.warn({
                    requestId: req.requestId,
                    method: req.method,
                    path: req.path,
                    timeout: timeoutMs,
                }, 'Request timeout exceeded');
                
                res.status(504).json({
                    status: 'error',
                    error: {
                        code: 'error.api.timeout',
                        context: {
                            timeout: timeoutMs / 1000, // seconds
                        },
                    },
                });
            }
        }, timeoutMs);

        // Clear timeout when response finishes
        const originalEnd = res.end;
        res.end = function(...args) {
            clearTimeout(timeout);
            originalEnd.apply(this, args);
        };

        next();
    };
}

