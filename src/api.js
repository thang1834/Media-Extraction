/**
 * API Entry Point
 * 
 * This is the main entry point for the API server.
 * It initializes the Express application and sets up the API routes.
 * 
 * Features:
 * - Cluster mode support for multi-instance deployment
 * - Environment file watching for hot-reloading
 * - Express app configuration
 */

/**
 * Suppress experimental warning for EnvHttpProxyAgent
 * Must be done BEFORE any imports to catch the warning early
 * This is expected when using undici's experimental proxy agent
 * The warning is harmless and can be safely ignored
 */
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    // Suppress EnvHttpProxyAgent experimental warning silently
    // Check both warning.name and warning.message to catch all variations
    const isEnvHttpProxyWarning = 
        (warning.name === 'ExperimentalWarning' || warning.name === 'Warning') &&
        (warning.message && warning.message.includes('EnvHttpProxyAgent'));
    
    if (isEnvHttpProxyWarning) {
        return; // Suppress this specific warning - no need to log
    }
    // For other warnings, we'll log them after logger is initialized
    // Store them temporarily if needed
});

// Load environment variables from .env file
import "dotenv/config";

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import { env, isCluster } from "./config.js"
import { initCluster } from "./misc/cluster.js";
import { setupEnvWatcher } from "./core/env.js";
import { logger } from "./util/logger.js";
import { initErrorTracking } from "./util/error-tracker.js";
import { validateAndLogConfig } from "./util/config-validator.js";

// Update warning handler to use logger for non-suppressed warnings
// The EnvHttpProxyAgent warning is already suppressed above
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    // Suppress EnvHttpProxyAgent experimental warning silently
    // Check both warning.name and warning.message to catch all variations
    const isEnvHttpProxyWarning = 
        (warning.name === 'ExperimentalWarning' || warning.name === 'Warning') &&
        (warning.message && warning.message.includes('EnvHttpProxyAgent'));
    
    if (isEnvHttpProxyWarning) {
        return; // Suppress this specific warning completely
    }
    // Log other warnings normally (now that logger is available)
    logger.warn({ warning: warning.stack }, 'Node.js warning');
});

// Initialize Express application
const app = express();

// Get current file and directory paths (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
// Remove '/src' from the path to get project root
const __dirname = path.dirname(__filename).slice(0, -4);

// Disable X-Powered-By header for security (prevents revealing Express version)
app.disable("x-powered-by");

/**
 * STARTUP SEQUENCE
 * 
 * 1. Validate configuration
 * 2. Initialize error tracking (if configured)
 * 3. Start API server
 */

// Validate configuration before starting
try {
    validateAndLogConfig(env);
} catch (error) {
    logger.error('\n' + '='.repeat(70));
    logger.error('  Configuration Validation Failed');
    logger.error('='.repeat(70));
    logger.error(`  Error: ${error.message}`);
    logger.error('='.repeat(70) + '\n');
    process.exit(1);
}

// Initialize error tracking (Sentry) if configured
if (process.env.SENTRY_DSN) {
    await initErrorTracking({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        release: process.env.SENTRY_RELEASE,
        sampleRate: process.env.SENTRY_SAMPLE_RATE ? parseFloat(process.env.SENTRY_SAMPLE_RATE) : 1.0,
    });
    logger.info({}, 'Error tracking initialized');
}

// Only start API if API_URL is configured
if (env.apiURL) {
    // Dynamically import API module (allows for better code splitting)
    const { runAPI } = await import("./core/api.js");

    // Initialize cluster mode if enabled (for multi-instance deployment)
    // Cluster mode allows running multiple instances of the API on the same port
    // using Node.js cluster module for better performance and reliability
    if (isCluster) {
       await initCluster();
    }

    // Set up environment file watcher if env file path is configured
    // This allows hot-reloading of environment variables without restarting the server
    if (env.envFile) {
        setupEnvWatcher();
    }

    // Start the API server
    runAPI(app, __dirname);
} else {
    // API_URL is required - exit with error message if not configured
    logger.error({}, "API_URL env variable is missing, api can't start");
    process.exit(1);
}

