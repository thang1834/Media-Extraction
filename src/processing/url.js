/**
 * URL Processing Module
 * 
 * This module handles URL normalization, validation, and service extraction.
 * It converts various URL formats to canonical forms and matches them against service patterns.
 * 
 * Functions:
 * - aliasURL(): Converts URL variants to canonical form
 * - cleanURL(): Removes unnecessary query params and normalizes URL
 * - getHostIfValid(): Validates domain and extracts service hostname
 * - normalizeURL(): Main function that combines aliasURL and cleanURL
 * - extract(): Extracts service and pattern match from URL
 * - resolveRedirectingURL(): Resolves redirect chains to get final URL
 */

import psl from "@imput/psl";
import { strict as assert } from "node:assert";

import { env } from "../config.js";
import { services } from "./service-config.js";
import { getRedirectingURL } from "../misc/utils.js";
import { friendlyServiceName } from "./service-alias.js";
import { LRUCache } from "../util/lru-cache.js";
import { applyAliasMapping, applyCleanMapping } from "./url-normalizers.js";
import { logger } from "../util/logger.js";

/**
 * Pattern matching result cache
 * 
 * Caches URL -> pattern match results to avoid re-processing the same URLs.
 * This significantly improves performance for repeated requests.
 * 
 * Cache key: normalized URL string
 * Cache value: { host, patternMatch } or { error, context }
 * TTL: 5 minutes (URLs don't change frequently)
 */
const patternMatchCache = new LRUCache({
    max: 5000, // Cache up to 5000 URLs
    ttl: 5 * 60 * 1000 // 5 minutes TTL
});

/**
 * Normalized URL cache
 * 
 * Caches raw URL -> normalized URL to avoid re-normalization.
 * 
 * Cache key: raw URL string
 * Cache value: normalized URL string
 * TTL: 10 minutes
 */
const normalizedURLCache = new LRUCache({
    max: 10000, // Cache up to 10000 URLs
    ttl: 10 * 60 * 1000 // 10 minutes TTL
});

// Cleanup expired cache entries periodically
setInterval(() => {
    patternMatchCache.cleanup();
    normalizedURLCache.cleanup();
}, 5 * 60 * 1000); // Cleanup every 5 minutes

/**
 * Converts URL variants to canonical form
 * 
 * Handles various URL formats for each service:
 * - Short URLs (youtu.be, b23.tv, etc.)
 * - Alternative domains (x.com, vxtwitter.com, etc.)
 * - Special paths (youtube.com/live/, youtube.com/shorts/, etc.)
 * 
 * Uses service-specific normalizers from url-normalizers.js registry.
 * 
 * @param {URL} url - URL object to normalize
 * @returns {URL} Normalized URL object
 */
function aliasURL(url) {
    assert(url instanceof URL);

    // Parse hostname to extract subdomain, domain, and TLD
    const host = psl.parse(url.hostname);

    // Apply service-specific alias mapping
    // This replaces the large switch statement with a registry pattern
    return applyAliasMapping(url, host);
}

/**
 * Cleans and normalizes URL by removing unnecessary parts
 * 
 * Removes:
 * - Unnecessary query parameters (keeps only essential ones)
 * - Hash fragments
 * - Username/password
 * - Port numbers
 * - Trailing slashes
 * 
 * Keeps essential query parameters for certain services:
 * - YouTube: ?v= (video ID)
 * - Bilibili: ?p= (part number)
 * - Twitter: ?post_id= (post ID)
 * - Xiaohongshu: ?xsec_token= (security token)
 * 
 * Uses service-specific clean mappers from url-normalizers.js registry.
 * 
 * @param {URL} url - URL object to clean
 * @returns {URL} Cleaned URL object
 */
function cleanURL(url) {
    assert(url instanceof URL);
    const host = psl.parse(url.hostname).sld;

    // Apply service-specific clean mapping
    // This replaces the large switch statement with a registry pattern
    // Returns true if query params should be stripped, false otherwise
    const stripQuery = applyCleanMapping(url, host);

    // Remove all query params if we didn't keep any
    if (stripQuery) {
        url.search = '';
    }

    // Remove authentication, port, and hash
    url.username = url.password = url.port = url.hash = '';

    // Remove trailing slash from pathname
    if (url.pathname.endsWith('/'))
        url.pathname = url.pathname.slice(0, -1);

    return url;
}

/**
 * Validates URL and extracts service hostname
 * 
 * Checks:
 * - Domain parsing is valid
 * - Service is configured
 * - TLD matches service configuration
 * - Subdomain is allowed (or service allows all subdomains)
 * 
 * @param {URL} url - URL object to validate
 * @returns {string|undefined} Service hostname (e.g., "youtube", "tiktok") or undefined if invalid
 */
function getHostIfValid(url) {
    const host = psl.parse(url.hostname);
    
    // Check if domain parsing failed
    if (host.error) return;

    // Check if service is configured
    const service = services[host.sld];
    if (!service) return;
    
    // Check if TLD matches (default is 'com' if not specified)
    if ((service.tld ?? 'com') !== host.tld) return;

    // Check if subdomain is allowed
    // Some services allow all subdomains (*), others have a specific list
    const anySubdomainAllowed = service.subdomains === '*';
    // null subdomain means no subdomain (e.g., youtube.com)
    // 'www' is always allowed as it's equivalent to no subdomain
    const validSubdomain = [null, 'www', ...(service.subdomains ?? [])].includes(host.subdomain);
    if (!validSubdomain && !anySubdomainAllowed) return;

    return host.sld;
}

/**
 * Normalizes a URL string to canonical form
 * 
 * Combines aliasURL and cleanURL to fully normalize a URL:
 * 1. Fixes common typos (https// -> https://)
 * 2. Converts variants to canonical form
 * 3. Removes unnecessary parts
 * 
 * Uses caching to avoid re-normalizing the same URLs.
 * 
 * @param {string} url - URL string to normalize
 * @returns {URL} Normalized URL object
 */
export function normalizeURL(url) {
    // Check cache first
    const cached = normalizedURLCache.get(url);
    if (cached) {
        return new URL(cached);
    }

    // Fix common typo: https// -> https://
    const normalized = cleanURL(
        aliasURL(
            new URL(url.replace(/^https\/\//, 'https://'))
        )
    );

    // Cache the normalized URL string
    normalizedURLCache.set(url, normalized.toString());

    return normalized;
}

/**
 * Extracts service and pattern match from URL
 * 
 * This is the main function for URL processing:
 * 1. Normalizes the URL
 * 2. Validates the domain
 * 3. Checks if service is enabled
 * 4. Matches URL against service patterns
 * 5. Returns service hostname and matched parameters
 * 
 * Uses caching to avoid re-processing the same URLs.
 * 
 * @param {URL|string} url - URL to extract from
 * @param {Set<string>} enabledServices - Set of enabled service hostnames
 * @returns {Object} Object with either:
 *   - { host, patternMatch } on success
 *   - { error, context? } on failure
 */
export function extract(url, enabledServices = env.enabledServices) {
    // Convert string to URL object if needed
    if (!(url instanceof URL)) {
        url = new URL(url);
    }

    // Create cache key from normalized URL
    // Include enabledServices in key to handle different service configurations
    const normalizedURLString = url.toString();
    const cacheKey = `${normalizedURLString}:${Array.from(enabledServices).sort().join(',')}`;

    // Check cache first
    const cached = patternMatchCache.get(cacheKey);
    if (cached) {
        // Clone the result to avoid mutation issues
        return { ...cached };
    }

    // Validate and get service hostname
    const host = getHostIfValid(url);

    if (!host) {
        const result = { error: "link.invalid" };
        patternMatchCache.set(cacheKey, result);
        return result;
    }

    // Check if service is enabled
    if (!enabledServices.has(host)) {
        // Special message for YouTube on official instances when it's temporarily disabled
        // This only happens in emergency situations
        let result;
        if (new URL(env.apiURL).hostname.endsWith(".imput.net") && host === "youtube") {
            result = { error: "youtube.temporary_disabled" };
        } else {
            result = { error: "service.disabled" };
        }
        patternMatchCache.set(cacheKey, result);
        return result;
    }

    // Try to match URL against service patterns
    // Patterns are tried in order, first match wins
    // Most common patterns should be first for better performance
    const pathToMatch = url.pathname.substring(1) + url.search;
    let patternMatch;
    for (const pattern of services[host].patterns) {
        // Match against pathname (without leading /) + search params
        patternMatch = pattern.match(pathToMatch);

        if (patternMatch) {
            break;
        }
    }

    // If no pattern matched, URL format is not supported
    if (!patternMatch) {
        const result = {
            error: "link.unsupported",
            context: {
                service: friendlyServiceName(host),
            }
        };
        patternMatchCache.set(cacheKey, result);
        // Log for debugging playlist URLs
        if (host === "tiktok" && pathToMatch.includes("playlist")) {
            logger.debug({ 
                host, 
                pathToMatch, 
                pathname: url.pathname, 
                search: url.search,
                patterns: services[host].patterns.map(p => p.pattern || p.toString())
            }, 'TikTok playlist URL pattern matching failed');
        }
        return result;
    }

    // Return service and matched parameters
    const result = { host, patternMatch };
    patternMatchCache.set(cacheKey, result);
    return result;
}

/**
 * Resolves redirect chains to get the final URL
 * 
 * Some services use redirect chains before reaching the final media URL.
 * This function follows redirects and extracts the pattern match from the final URL.
 * 
 * Used when:
 * - Service uses redirects before serving media
 * - Need to get canonical URL from a short link
 * 
 * @param {URL|string} url - Initial URL (may redirect)
 * @param {Object} dispatcher - Network dispatcher for making requests
 * @param {Object} headers - HTTP headers to use for request
 * @returns {Promise<Object|undefined>} Pattern match from final URL, or undefined if:
 *   - Original URL is invalid
 *   - Redirect resolution fails
 *   - Final URL is from a different service
 */
export async function resolveRedirectingURL(url, dispatcher, headers) {
    // Get service from original URL
    const originalService = getHostIfValid(normalizeURL(url));
    if (!originalService) return;

    // Follow redirect chain to get canonical URL
    const canonicalURL = await getRedirectingURL(url, dispatcher, headers);
    if (!canonicalURL) return;

    // Extract service and pattern from final URL
    const { host, patternMatch } = extract(normalizeURL(canonicalURL));

    // Only return if final URL is from the same service
    // This prevents following redirects to different services
    if (host === originalService) {
        return patternMatch;
    }
}
