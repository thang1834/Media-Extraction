/**
 * Error Tracking Utility
 * 
 * Provides error tracking integration with Sentry (optional).
 * Only initializes if SENTRY_DSN is configured.
 */

let sentry = null;
let isInitialized = false;

/**
 * Initialize error tracking
 * 
 * @param {Object} options - Sentry configuration options
 * @param {string} options.dsn - Sentry DSN
 * @param {string} [options.environment] - Environment name (production, development, etc.)
 * @param {string} [options.release] - Release version
 * @param {number} [options.sampleRate] - Error sampling rate (0.0 to 1.0)
 */
export async function initErrorTracking(options = {}) {
    if (isInitialized) {
        return;
    }

    const { dsn, environment, release, sampleRate = 1.0 } = options;

    if (!dsn) {
        return; // Sentry not configured
    }

    try {
        // Dynamically import Sentry (optional dependency)
        const Sentry = await import('@sentry/node').catch(() => null);
        
        if (!Sentry) {
            console.warn('Sentry package not installed. Error tracking disabled.');
            return;
        }

        Sentry.init({
            dsn,
            environment: environment || process.env.NODE_ENV || 'development',
            release,
            sampleRate,
            tracesSampleRate: sampleRate,
            // Capture unhandled promise rejections
            captureUnhandledRejections: true,
            // Capture uncaught exceptions
            captureUncaughtExceptions: true,
            // Don't capture console errors (we handle those ourselves)
            beforeSend(event, hint) {
                // Filter out certain errors if needed
                const error = hint.originalException;
                
                // Don't send validation errors
                if (error && error.name === 'ZodError') {
                    return null;
                }
                
                return event;
            },
            // Add custom tags
            initialScope: {
                tags: {
                    component: 'media-extraction-api',
                },
            },
        });

        sentry = Sentry;
        isInitialized = true;
    } catch (error) {
        console.error('Failed to initialize Sentry:', error);
    }
}

/**
 * Capture exception to error tracking service
 * 
 * @param {Error} error - Error to capture
 * @param {Object} context - Additional context
 */
export function captureException(error, context = {}) {
    if (!sentry || !isInitialized) {
        return;
    }

    try {
        sentry.withScope((scope) => {
            // Add context as tags and extra data
            if (context.requestId) {
                scope.setTag('requestId', context.requestId);
            }
            
            if (context.service) {
                scope.setTag('service', context.service);
            }
            
            if (context.url) {
                scope.setContext('request', {
                    url: context.url,
                });
            }

            // Add all context as extra data
            scope.setExtras(context);

            // Capture the exception
            sentry.captureException(error);
        });
    } catch (err) {
        // Silently fail if Sentry has issues
        console.error('Failed to capture exception to Sentry:', err);
    }
}

/**
 * Capture message to error tracking service
 * 
 * @param {string} message - Message to capture
 * @param {string} level - Severity level (error, warning, info)
 * @param {Object} context - Additional context
 */
export function captureMessage(message, level = 'error', context = {}) {
    if (!sentry || !isInitialized) {
        return;
    }

    try {
        sentry.withScope((scope) => {
            // Add context as tags and extra data
            if (context.requestId) {
                scope.setTag('requestId', context.requestId);
            }
            
            if (context.service) {
                scope.setTag('service', context.service);
            }

            // Add all context as extra data
            scope.setExtras(context);

            // Capture the message
            sentry.captureMessage(message, level);
        });
    } catch (err) {
        // Silently fail if Sentry has issues
        console.error('Failed to capture message to Sentry:', err);
    }
}

/**
 * Set user context for error tracking
 * 
 * @param {Object} user - User information
 * @param {string} user.id - User ID
 * @param {string} [user.ip] - User IP address
 */
export function setUser(user) {
    if (!sentry || !isInitialized) {
        return;
    }

    try {
        sentry.setUser(user);
    } catch (err) {
        console.error('Failed to set user in Sentry:', err);
    }
}

/**
 * Add breadcrumb for debugging
 * 
 * @param {string} message - Breadcrumb message
 * @param {string} category - Breadcrumb category
 * @param {string} level - Severity level
 * @param {Object} data - Additional data
 */
export function addBreadcrumb(message, category, level = 'info', data = {}) {
    if (!sentry || !isInitialized) {
        return;
    }

    try {
        sentry.addBreadcrumb({
            message,
            category,
            level,
            data,
            timestamp: Date.now() / 1000,
        });
    } catch (err) {
        // Silently fail
    }
}

/**
 * Check if error tracking is enabled
 * 
 * @returns {boolean} True if error tracking is initialized
 */
export function isErrorTrackingEnabled() {
    return isInitialized && sentry !== null;
}

