/**
 * Circuit Breaker Utility
 * 
 * Implements circuit breaker pattern to prevent cascading failures
 * when external services are down or slow.
 */

import { logger } from './logger.js';

/**
 * Circuit breaker states
 */
const STATES = {
    CLOSED: 'closed',      // Normal operation
    OPEN: 'open',          // Failing, reject requests immediately
    HALF_OPEN: 'half_open', // Testing if service recovered
};

/**
 * Create a circuit breaker
 * 
 * @param {Object} options - Circuit breaker options
 * @param {string} options.name - Circuit breaker name (for logging)
 * @param {number} options.failureThreshold - Number of failures before opening
 * @param {number} options.resetTimeout - Time in ms before attempting to close
 * @param {number} options.monitoringWindow - Time window for failure counting
 * @returns {Object} Circuit breaker instance
 */
export function createCircuitBreaker(options = {}) {
    const {
        name = 'circuit-breaker',
        failureThreshold = 5,
        resetTimeout = 60000, // 1 minute
        monitoringWindow = 60000, // 1 minute
    } = options;

    let state = STATES.CLOSED;
    let failures = [];
    let nextAttempt = 0;

    /**
     * Record a failure
     */
    function recordFailure() {
        const now = Date.now();
        
        // Remove old failures outside monitoring window
        failures = failures.filter(time => now - time < monitoringWindow);
        
        // Add current failure
        failures.push(now);
        
        // Check if we should open the circuit
        if (failures.length >= failureThreshold) {
            if (state === STATES.CLOSED) {
                state = STATES.OPEN;
                nextAttempt = now + resetTimeout;
                
                logger.warn({
                    circuitBreaker: name,
                    state: 'OPEN',
                    failures: failures.length,
                    nextAttempt: new Date(nextAttempt).toISOString(),
                }, 'Circuit breaker opened');
            }
        }
    }

    /**
     * Record a success
     */
    function recordSuccess() {
        if (state === STATES.HALF_OPEN) {
            state = STATES.CLOSED;
            failures = [];
            
            logger.info({
                circuitBreaker: name,
                state: 'CLOSED',
            }, 'Circuit breaker closed');
        } else if (state === STATES.CLOSED) {
            // Remove old failures
            const now = Date.now();
            failures = failures.filter(time => now - time < monitoringWindow);
        }
    }

    /**
     * Execute function with circuit breaker protection
     * 
     * @param {Function} fn - Function to execute
     * @returns {Promise} Function result
     */
    async function execute(fn) {
        const now = Date.now();

        // Check if circuit is open
        if (state === STATES.OPEN) {
            if (now < nextAttempt) {
                // Still in cooldown period
                const error = new Error(`Circuit breaker is OPEN for ${name}`);
                error.code = 'CIRCUIT_BREAKER_OPEN';
                error.circuitBreaker = name;
                error.retryAfter = Math.ceil((nextAttempt - now) / 1000);
                throw error;
            } else {
                // Attempt to recover
                state = STATES.HALF_OPEN;
                
                logger.info({
                    circuitBreaker: name,
                    state: 'HALF_OPEN',
                }, 'Circuit breaker attempting recovery');
            }
        }

        try {
            const result = await fn();
            recordSuccess();
            return result;
        } catch (error) {
            recordFailure();
            throw error;
        }
    }

    /**
     * Get current state
     */
    function getState() {
        return {
            state,
            failures: failures.length,
            nextAttempt: state === STATES.OPEN ? nextAttempt : null,
        };
    }

    /**
     * Reset circuit breaker (for testing/admin)
     */
    function reset() {
        state = STATES.CLOSED;
        failures = [];
        nextAttempt = 0;
        
        logger.info({
            circuitBreaker: name,
        }, 'Circuit breaker manually reset');
    }

    return {
        execute,
        getState,
        reset,
        name,
    };
}

/**
 * Create circuit breaker for service calls
 * 
 * @param {string} serviceName - Service name
 * @param {Object} options - Circuit breaker options
 * @returns {Object} Circuit breaker instance
 */
export function createServiceCircuitBreaker(serviceName, options = {}) {
    return createCircuitBreaker({
        name: `service:${serviceName}`,
        ...options,
    });
}

