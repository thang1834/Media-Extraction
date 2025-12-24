/**
 * Error Handler Utility
 * 
 * Centralized error handling for service handlers and API responses.
 * Provides consistent error formatting, context generation, and error code mapping.
 * 
 * Error Types:
 * - critical: Server-side issues that should not be retried
 * - error: User errors, rate limits, or recoverable issues
 */

import { env } from "../config.js";
import { friendlyServiceName } from "./service-alias.js";
import { logError } from "../util/logger.js";

/**
 * Error context generators
 * 
 * Maps error codes to context generators that provide additional
 * information for error messages.
 */
const errorContextGenerators = {
    /**
     * Content duration limit exceeded
     */
    "content.too_long": () => ({
        limit: parseFloat((env.durationLimit / 60).toFixed(2)), // Convert to minutes
    }),

    /**
     * Fetch-related errors (fail, rate, critical, empty)
     * Include service name for better error messages
     */
    "fetch.fail": (host) => ({
        service: friendlyServiceName(host),
    }),
    "fetch.rate": (host) => ({
        service: friendlyServiceName(host),
    }),
    "fetch.critical": (host) => ({
        service: friendlyServiceName(host),
    }),
    "fetch.empty": (host) => ({
        service: friendlyServiceName(host),
    }),

    /**
     * Link/content errors
     */
    "link.unsupported": (host) => ({
        service: friendlyServiceName(host),
    }),
    "content.video.unavailable": (host) => ({
        service: friendlyServiceName(host),
    }),
    "content.video.private": (host) => ({
        service: friendlyServiceName(host),
    }),
    "content.post.private": (host) => ({
        service: friendlyServiceName(host),
    }),
    "content.post.age": (host) => ({
        service: friendlyServiceName(host),
    }),
    "content.post.unavailable": (host) => ({
        service: friendlyServiceName(host),
    }),

    /**
     * YouTube-specific errors
     */
    "youtube.no_session_tokens": () => ({}),
    "youtube.decipher": () => ({}),
    "youtube.token_expired": () => ({}),
    "youtube.api_error": () => ({}),
};

/**
 * Handle service handler error
 * 
 * Converts service handler error format to API response format.
 * 
 * @param {Object} errorResult - Error result from service handler
 * @param {string} errorResult.error - Error code
 * @param {boolean} [errorResult.critical] - Whether error is critical
 * @param {string} host - Service hostname
 * @returns {Object} API response object with error code and context
 */
export function handleServiceError(errorResult, host) {
    const { error, critical } = errorResult;

    if (!error) {
        return null; // No error
    }

    // Handle critical errors (server-side issues)
    // Critical errors indicate problems with the service handler itself
    // and should not be retried by the client
    if (critical) {
        return {
            type: "critical",
            code: `error.api.${error}`,
            context: getErrorContext(error, host),
        };
    }

    // Handle non-critical errors (user errors, rate limits, etc.)
    // These can be retried or handled by the client
    return {
        type: "error",
        code: `error.api.${error}`,
        context: getErrorContext(error, host),
    };
}

/**
 * Get error context for error code
 * 
 * Generates context object with additional information for error messages.
 * 
 * @param {string} errorCode - Error code (e.g., "fetch.fail", "content.too_long")
 * @param {string} host - Service hostname
 * @returns {Object|undefined} Error context object or undefined
 */
function getErrorContext(errorCode, host) {
    const generator = errorContextGenerators[errorCode];
    
    if (!generator) {
        return undefined; // No context for this error
    }

    // Call generator with host parameter
    // Some generators don't use host, but we pass it for consistency
    return generator(host);
}

/**
 * Handle unexpected errors
 * 
 * Catches unexpected errors during processing and converts them to
 * user-friendly error responses.
 * 
 * @param {Error} error - Caught error object
 * @param {string} host - Service hostname
 * @returns {Object} API response object with critical error
 */
export function handleUnexpectedError(error, host, requestId = null) {
    // Log error with full context
    logError(error, {
        requestId,
        service: host,
        serviceName: friendlyServiceName(host),
    });

    return {
        type: "error",
        code: "error.api.fetch.critical",
        context: {
            service: friendlyServiceName(host),
        },
    };
}

/**
 * Check if result is an error
 * 
 * @param {Object} result - Service handler result
 * @returns {boolean} True if result contains an error
 */
export function isError(result) {
    return result && result.error;
}

/**
 * Check if error is critical
 * 
 * @param {Object} errorResult - Error result from service handler
 * @returns {boolean} True if error is critical
 */
export function isCriticalError(errorResult) {
    return errorResult && errorResult.error && errorResult.critical === true;
}

