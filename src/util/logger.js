/**
 * Structured Logging Utility
 * 
 * Provides centralized logging using pino for structured, performant logging.
 * Supports different log levels and formats (JSON for production, pretty for development).
 */

import pino from 'pino';
import { env } from '../config.js';
import { captureException, captureMessage, addBreadcrumb } from './error-tracker.js';

// Determine if we're in development mode
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Create logger instance
 * 
 * Suppresses experimental warnings in pino-pretty output
 * by filtering out EnvHttpProxyAgent warnings
 */
export const logger = pino({
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    formatters: {
        level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Pretty print in development, JSON in production
    transport: isDevelopment ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            // Suppress experimental warnings in output
            hideObject: false,
        },
    } : undefined,
});

/**
 * Create child logger with context
 * Useful for adding request ID, service name, etc.
 * 
 * @param {Object} bindings - Context to bind to all log messages
 * @returns {pino.Logger} Child logger instance
 */
export function createChildLogger(bindings) {
    return logger.child(bindings);
}

/**
 * Log request with context
 * 
 * @param {Object} req - Express request object
 * @param {string} requestId - Request ID
 */
export function logRequest(req, requestId) {
    logger.info({
        requestId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent'),
    }, 'Incoming request');
    
    // Add breadcrumb for error tracking
    addBreadcrumb(
        `${req.method} ${req.path}`,
        'http',
        'info',
        {
            requestId,
            ip: req.ip,
        }
    );
}

/**
 * Log response with context
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} requestId - Request ID
 * @param {number} duration - Request duration in ms
 */
export function logResponse(req, res, requestId, duration) {
    logger.info({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
    }, 'Request completed');
}

/**
 * Log error with full context
 * 
 * @param {Error|Object} error - Error object or error info
 * @param {Object} context - Additional context
 */
export function logError(error, context = {}) {
    if (error instanceof Error) {
        logger.error({
            ...context,
            err: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
        }, 'Error occurred');
        
        // Send to error tracking service
        captureException(error, context);
    } else {
        logger.error({
            ...context,
            error,
        }, 'Error occurred');
        
        // Send message to error tracking service
        captureMessage(String(error), 'error', context);
    }
}

/**
 * Log service handler result
 * 
 * @param {string} service - Service name
 * @param {string} requestId - Request ID
 * @param {Object} result - Service handler result
 */
export function logServiceResult(service, requestId, result) {
    if (result.error) {
        logger.warn({
            requestId,
            service,
            error: result.error,
            critical: result.critical,
        }, 'Service handler returned error');
    } else {
        logger.debug({
            requestId,
            service,
            hasUrls: !!result.urls,
            hasMetadata: !!result.fileMetadata,
        }, 'Service handler completed');
    }
}
