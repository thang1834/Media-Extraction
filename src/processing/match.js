/**
 * Service Matching Module
 * 
 * This module handles the matching and processing of media URLs for different services.
 * It validates URL patterns, calls the appropriate service handler, and processes the results.
 * 
 * Flow:
 * 1. Validate URL pattern
 * 2. Setup network dispatcher (if freebind is enabled)
 * 3. Call service-specific handler
 * 4. Handle errors and edge cases
 * 5. Determine processing requirements
 * 6. Pass to matchAction for response generation
 */

import { strict as assert } from "node:assert";

import { env } from "../config.js";
import { createResponse } from "../processing/request.js";

import { testers } from "./service-patterns.js";
import matchAction from "./match-action.js";

import { friendlyServiceName } from "./service-alias.js";
import { LRUCache } from "../util/lru-cache.js";
import { getServiceConfig, isServiceRegistered } from "./service-registry.js";
import { handleServiceError, handleUnexpectedError } from "./error-handler.js";
import { CACHE_TTL } from "../util/constants.js";
import { logError } from "../util/logger.js";

// Service handler cache for lazy loading
// This reduces memory usage and startup time by only loading handlers when needed
const serviceHandlers = new Map();

/**
 * Metadata response cache
 * 
 * Caches service handler responses (metadata only, not media URLs) to reduce
 * load on external services and improve response times for repeated requests.
 * 
 * Cache key: host + patternMatch hash + params hash
 * Cache value: Service handler result (with URLs removed for security)
 * TTL: 5 minutes (metadata doesn't change frequently)
 * 
 * Note: We don't cache media URLs as they may expire or change.
 */
const metadataCache = new LRUCache({
    max: 1000, // Cache up to 1000 metadata responses
    ttl: CACHE_TTL.METADATA
});

/**
 * Generate cache key from request parameters
 * 
 * @param {string} host - Service hostname
 * @param {Object} patternMatch - Matched URL parameters
 * @param {Object} params - Request parameters
 * @returns {string} Cache key
 */
function generateCacheKey(host, patternMatch, params) {
    // Create a hash of relevant parameters
    // Exclude parameters that don't affect metadata (like alwaysProxy, localProcessing)
    const relevantParams = {
        videoQuality: params.videoQuality,
        downloadMode: params.downloadMode,
        audioFormat: params.audioFormat,
        youtubeVideoCodec: params.youtubeVideoCodec,
        youtubeVideoContainer: params.youtubeVideoContainer,
        youtubeDubLang: params.youtubeDubLang,
        subtitleLang: params.subtitleLang,
        tiktokFullAudio: params.tiktokFullAudio,
        allowH265: params.allowH265,
        convertGif: params.convertGif,
        youtubeHLS: params.youtubeHLS,
        youtubeBetterAudio: params.youtubeBetterAudio,
    };

    // Create deterministic string from patternMatch and params
    const patternStr = JSON.stringify(patternMatch);
    const paramsStr = JSON.stringify(relevantParams);
    
    return `${host}:${patternStr}:${paramsStr}`;
}

/**
 * Create cacheable metadata response
 * 
 * Removes URLs and other non-cacheable data from service handler response.
 * 
 * @param {Object} response - Service handler response
 * @returns {Object} Cacheable metadata object
 */
function createCacheableMetadata(response) {
    // Clone response and remove non-cacheable fields
    const cacheable = { ...response };
    
    // Remove URLs (they may expire or change)
    delete cacheable.urls;
    
    // Remove headers (may contain auth tokens)
    delete cacheable.headers;
    
    // Remove originalRequest (contains full URL)
    delete cacheable.originalRequest;
    
    // Keep metadata, filenames, and other static info
    return cacheable;
}

/**
 * Merge cached metadata with fresh URLs
 * 
 * @param {Object} cached - Cached metadata
 * @param {Object} fresh - Fresh service handler response
 * @returns {Object} Merged response
 */
function mergeCachedMetadata(cached, fresh) {
    return {
        ...cached,
        // Use fresh URLs and headers
        urls: fresh.urls,
        headers: fresh.headers,
        originalRequest: fresh.originalRequest,
        // Update any other fields that may have changed
        error: fresh.error,
        critical: fresh.critical,
    };
}

/**
 * Lazy load service handler
 * 
 * Loads service handler on-demand and caches it for future use.
 * This improves startup time and reduces memory usage.
 * 
 * @param {string} host - Service hostname (e.g., "youtube", "tiktok")
 * @returns {Promise<Function>} Service handler function
 */
async function getServiceHandler(host) {
    // Return cached handler if available
    if (serviceHandlers.has(host)) {
        return serviceHandlers.get(host);
    }

    // Dynamically import service handler
    try {
        const handlerModule = await import(`./services/${host}.js`);
        const handler = handlerModule.default;
        
        // Cache the handler for future use
        serviceHandlers.set(host, handler);
        
        return handler;
    } catch (error) {
        logError(error, { service: host }, 'Failed to load service handler');
        throw error;
    }
}

// Lazy-load freebind module (only if needed)
let freebind;

/**
 * Main matching function
 * 
 * @param {Object} options - Matching options
 * @param {string} options.host - Service hostname (e.g., "youtube", "tiktok")
 * @param {Object} options.patternMatch - Matched URL pattern parameters
 * @param {Object} options.params - Request parameters (quality, format, etc.)
 * @param {string} options.authType - Authentication type ("key", "session", "none")
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<Object>} Response object with status and body
 */
export default async function({ host, patternMatch, params, authType, requestId = null }) {
    const { url } = params;
    assert(url instanceof URL);
    
    // Network dispatcher and IP for freebind (if enabled)
    // Freebind allows binding to specific IP addresses for outbound connections
    let dispatcher, requestIP;

    // Setup freebind if configured (Linux only)
    // Freebind allows using multiple source IPs for outbound connections
    // This is useful for load balancing and avoiding rate limits
    if (env.freebindCIDR) {
        // Lazy-load freebind module (it's an optional dependency)
        if (!freebind) {
            freebind = await import('freebind');
        }

        // Generate a random IP from the CIDR range
        requestIP = freebind.ip.random(env.freebindCIDR);
        // Create a dispatcher that will use this IP for all requests
        dispatcher = freebind.dispatcherFromIP(requestIP, { strict: false });
    }

    try {
        // Service handler result
        let r,
            // Determine if we should extract audio only
            isAudioOnly = params.downloadMode === "audio",
            // Determine if we should mute the video (remove audio track)
            isAudioMuted = params.downloadMode === "mute";

        // Validate that the service has a pattern tester
        // Pattern testers validate that extracted parameters are within acceptable ranges
        if (!testers[host]) {
            return createResponse("error", {
                code: "error.api.service.unsupported"
            });
        }
        
        // Validate the matched pattern parameters
        // This ensures IDs, usernames, etc. are within expected length limits
        if (!(testers[host](patternMatch))) {
            return createResponse("error", {
                code: "error.api.link.unsupported",
                context: {
                    service: friendlyServiceName(host),
                }
            });
        }

        // YouTube HLS support (deprecated, will be removed in future)
        // HLS (HTTP Live Streaming) is an older method for YouTube video delivery
        let youtubeHLS = params.youtubeHLS;
        const hlsEnv = env.enableDeprecatedYoutubeHls;

        // Disable HLS if:
        // - Environment says "never"
        // - Environment says "key" but user is not authenticated with API key
        if (hlsEnv === "never" || (hlsEnv === "key" && authType !== "key")) {
            youtubeHLS = false;
        }

        // Extract subtitle language if specified
        // "none" means no subtitles, otherwise use the specified language code
        const subtitleLang =
            params.subtitleLang !== "none" ? params.subtitleLang : undefined;

        // Check metadata cache first
        // We cache metadata to reduce load on external services
        // but always fetch fresh URLs as they may expire
        const cacheKey = generateCacheKey(host, patternMatch, params);
        const cachedMetadata = metadataCache.get(cacheKey);
        
        // Get service configuration from registry
        // This replaces the large switch statement with a more maintainable registry pattern
        const serviceConfig = getServiceConfig(host);
        
        if (!serviceConfig) {
            // Unknown service - should not happen if URL extraction is correct
            return createResponse("error", {
                code: "error.api.service.unsupported"
            });
        }

        // Get and call the appropriate service handler
        // Handlers are lazy-loaded to reduce memory usage and startup time
        const handler = await getServiceHandler(host);
        
        // Prepare context for params mapper
        // Context contains shared data needed by multiple services
        // We use an object for audio flags so they can be mutated by postHandler
        const audioFlags = { isAudioOnly, isAudioMuted };
        const context = {
            dispatcher,
            subtitleLang,
            isAudioOnly, // Pass current value for params mapper
            isAudioMuted, // Pass current value for params mapper
            audioFlags, // Pass object reference for postHandler to mutate
            url,
            youtubeHLS,
            env,
        };

        // Map patternMatch and params to handler-specific parameters
        // Each service has its own paramsMapper function that knows how to
        // transform the generic patternMatch into service-specific params
        const handlerParams = serviceConfig.paramsMapper(patternMatch, params, context);
        
        // Call service handler with mapped parameters
        r = await handler(handlerParams);
        
        // Execute post-handler logic if defined
        // Some services need to modify flags or results after handler execution
        // (e.g., SoundCloud forces audio-only mode)
        if (serviceConfig.postHandler) {
            r = serviceConfig.postHandler(r, context);
            // Update flags from audioFlags object (in case postHandler modified them)
            isAudioOnly = audioFlags.isAudioOnly;
            isAudioMuted = audioFlags.isAudioMuted;
        }

        // If we have cached metadata, merge it with fresh URLs
        // This allows us to cache metadata while always using fresh URLs
        // Only cache successful responses (no errors)
        if (cachedMetadata && !r.error) {
            r = mergeCachedMetadata(cachedMetadata, r);
        } else if (!r.error) {
            // Cache the metadata (without URLs) for future requests
            // URLs are excluded as they may expire or change
            const cacheableMetadata = createCacheableMetadata(r);
            metadataCache.set(cacheKey, cacheableMetadata);
        }

        // If service handler indicates audio-only content, update flags
        // Some services (like SoundCloud) always return audio-only
        if (r.isAudioOnly) {
            isAudioOnly = true;
            isAudioMuted = false;
        }

        // Handle service handler errors using centralized error handler
        // This provides consistent error formatting and context generation
        if (r.error) {
            const errorResponse = handleServiceError(r, host);
            if (errorResponse) {
                // Add request ID to error context for traceability
                const errorContext = {
                    ...errorResponse.context,
                    ...(requestId && { requestId }),
                };
                
                return createResponse(errorResponse.type, {
                    code: errorResponse.code,
                    context: errorContext,
                });
            }
        }

        // Determine local processing mode
        // Local processing means the server will download and process media (merge, remux, etc.)
        // instead of just redirecting to the original URL
        let localProcessing = params.localProcessing;
        const lpEnv = env.forceLocalProcessing;
        
        // Force local processing if:
        // - Environment says "always"
        // - Environment says "session" and user is authenticated with session token
        const shouldForceLocal = lpEnv === "always" || (lpEnv === "session" && authType === "session");
        const localDisabled = (!localProcessing || localProcessing === "disabled");

        // Upgrade to "preferred" if forced but currently disabled
        if (shouldForceLocal && localDisabled) {
            localProcessing = "preferred";
        }

        // Extract username from patternMatch for auto-download
        const username = patternMatch?.user || 
                        patternMatch?.username || 
                        patternMatch?.author;
        
        // Map downloadMode: "auto" to autoDownload: true
        // downloadMode: "auto" means automatically download when picker is returned
        // If downloadMode is "auto", always enable autoDownload
        const autoDownload = params.downloadMode === "auto" 
            ? true 
            : params.autoDownload;
        
        // Pass to matchAction to determine response type and format
        // matchAction will decide whether to redirect, tunnel, or process locally
        return matchAction({
            r, // Service handler result
            host,
            audioFormat: params.audioFormat,
            isAudioOnly,
            isAudioMuted,
            disableMetadata: params.disableMetadata,
            filenameStyle: params.filenameStyle,
            convertGif: params.convertGif,
            requestIP, // For freebind
            audioBitrate: params.audioBitrate,
            alwaysProxy: params.alwaysProxy || localProcessing === "forced", // Force proxy if local processing is forced
            localProcessing,
            autoDownload, // Auto download flag (mapped from downloadMode: "auto")
            username, // Username for folder structure
        })
    } catch (error) {
        // Catch any unexpected errors during processing
        // This prevents the server from crashing and provides a user-friendly error
        const errorResponse = handleUnexpectedError(error, host, requestId);
        
        // Add request ID to error context for traceability
        const errorContext = {
            ...errorResponse.context,
            ...(requestId && { requestId }),
        };
        
        return createResponse(errorResponse.type, {
            code: errorResponse.code,
            context: errorContext,
        });
    }
}
