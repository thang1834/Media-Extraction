/**
 * Application Constants
 * 
 * Centralized constants to avoid magic numbers and hardcoded values
 * throughout the codebase.
 */

// Time constants (in milliseconds)
export const TIME = {
    SECOND: 1000,
    MINUTE: 60 * 1000,
    HOUR: 60 * 60 * 1000,
    DAY: 24 * 60 * 60 * 1000,
};

// Cache TTL constants
export const CACHE_TTL = {
    METADATA: 5 * TIME.MINUTE,           // 5 minutes
    IP_KEY: 1 * TIME.MINUTE,             // 1 minute
    STREAM: 5 * TIME.MINUTE,              // 5 minutes
};

// Request/Response limits
export const LIMITS = {
    URL_MAX_LENGTH: 2048,                // Maximum URL length
    JSON_BODY_MAX_SIZE: 1024,            // Maximum JSON body size (1KB)
    REQUEST_TIMEOUT_DEFAULT: 30 * TIME.SECOND,  // 30 seconds
    REQUEST_TIMEOUT_MIN: 1 * TIME.SECOND,       // 1 second
    REQUEST_TIMEOUT_MAX: 5 * TIME.MINUTE,      // 5 minutes
};

// Stream constants
export const STREAM = {
    ID_LENGTH: 21,                       // Stream ID length (nanoid)
    EXP_LENGTH: 13,                      // Expiration timestamp length
    SIG_LENGTH: 43,                      // HMAC signature length (base64url)
    SEC_LENGTH: 43,                      // Secret length (base64url)
    IV_LENGTH: 22,                       // IV length (base64url)
    CLEANUP_INTERVAL: 1 * TIME.MINUTE,   // Stream cleanup interval
    TTL: 5 * TIME.MINUTE,                // Stream TTL
};

// YouTube constants
export const YOUTUBE = {
    PLAYER_REFRESH_PERIOD: 15 * TIME.MINUTE,  // Player refresh period
    VIDEO_QUALITIES: [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320],
};

// Security constants
export const SECURITY = {
    JWT_SECRET_MIN_LENGTH: 16,           // Minimum JWT secret length
    UUID_V4_LENGTH: 36,                  // UUID v4 string length
};

// Network constants
export const NETWORK = {
    IP_PREFIX: 56,                       // IPv6 prefix for rate limiting
    CIPHER_SHUFFLE_INTERVAL: 30 * TIME.MINUTE,  // Cipher shuffle interval
};

// User Agent
export const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// Default values
export const DEFAULTS = {
    API_PORT: 9000,
    RATE_LIMIT_WINDOW: 60,               // seconds
    RATE_LIMIT_MAX: 20,
    TUNNEL_RATE_LIMIT_MAX: 40,
    SESSION_RATE_LIMIT: 10,
    DURATION_LIMIT: 10800,                // 3 hours in seconds
    STREAM_LIFESPAN: 90,                  // seconds
    JWT_LIFETIME: 120,                    // minutes
    KEY_RELOAD_INTERVAL: 900,             // seconds
    YT_SESSION_RELOAD_INTERVAL: 300,      // seconds
    ENV_REMOTE_RELOAD_INTERVAL: 300,      // seconds
};

// Circuit breaker defaults
export const CIRCUIT_BREAKER = {
    FAILURE_THRESHOLD: 5,                // Number of failures before opening
    RESET_TIMEOUT: 60 * TIME.SECOND,     // Time before attempting to close
    MONITORING_WINDOW: 60 * TIME.SECOND,  // Time window for failure counting
};

