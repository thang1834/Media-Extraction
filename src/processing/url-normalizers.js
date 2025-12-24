/**
 * URL Normalizer Registry
 * 
 * Centralized registry for service-specific URL normalization logic.
 * This replaces the large switch statements in aliasURL() and cleanURL(),
 * making it easier to maintain and extend with new services.
 * 
 * Each service entry contains:
 * - aliasMapper: Function that converts URL variants to canonical form
 * - cleanMapper: Function that cleans query parameters (keeps essential ones)
 */

import psl from "@imput/psl";
import { services } from "./service-config.js";

/**
 * URL alias mapper registry
 * 
 * Maps service hostnames to their alias normalization functions.
 * These functions convert URL variants (short URLs, alt domains, etc.) to canonical form.
 * 
 * @type {Object<string, Function>}
 */
export const aliasMappers = {
    /**
     * YouTube URL aliasing
     * 
     * Handles:
     * - Live streams: /live/<id> -> /watch?v=<id>
     * - Shorts: /shorts/<id> -> /watch?v=<id>
     * - Short URLs: youtu.be/<id> -> youtube.com/watch?v=<id>
     */
    youtube: (url, host) => {
        const parts = url.pathname.split('/');

        // Convert live streams and shorts to standard watch format
        if (url.pathname.startsWith('/live/') || url.pathname.startsWith('/shorts/')) {
            url.pathname = '/watch';
            url.search = `?v=${encodeURIComponent(parts[2])}`;
        }

        return url;
    },

    /**
     * YouTube short URL aliasing (youtu.be)
     */
    youtu: (url, host) => {
        const parts = url.pathname.split('/');

        // Convert youtu.be short URLs to standard YouTube format
        if (url.hostname === 'youtu.be' && parts.length >= 2) {
            // youtu.be urls can be weird, e.g. https://youtu.be/<id>//asdasd// still works
            // but we only care about the 1st segment of the path
            url = new URL(`https://youtube.com/watch?v=${
                encodeURIComponent(parts[1])
            }`);
        }

        return url;
    },

    /**
     * Twitter/X URL aliasing
     * 
     * Handles:
     * - Alternative domains: x.com, vxtwitter.com, fixvx.com -> twitter.com
     */
    twitter: (url, host) => {
        // Convert Twitter/X alternative domains to canonical twitter.com
        if (services.twitter.altDomains.includes(url.hostname)) {
            url.hostname = 'twitter.com';
        }

        return url;
    },

    /**
     * Bilibili URL aliasing
     * 
     * Handles:
     * - bilibili.tv -> bilibili.com/_tv/...
     * - b23.tv short URLs -> bilibili.com/_shortLink/...
     */
    bilibili: (url, host) => {
        const parts = url.pathname.split('/');

        // Convert bilibili.tv to bilibili.com with _tv prefix
        if (host.tld === 'tv') {
            url = new URL(`https://bilibili.com/_tv${url.pathname}`);
        }

        return url;
    },

    /**
     * Bilibili short URL aliasing (b23.tv)
     */
    b23: (url, host) => {
        const parts = url.pathname.split('/');

        // Convert b23.tv short URLs to bilibili.com format
        if (url.hostname === 'b23.tv' && parts.length === 2) {
            url = new URL(`https://bilibili.com/_shortLink/${parts[1]}`);
        }

        return url;
    },

    /**
     * Facebook URL aliasing
     * 
     * Handles:
     * - Video URLs with ?v= parameter -> web.facebook.com/user/videos/<id>
     * - fb.watch short URLs -> web.facebook.com/_shortLink/<id>
     */
    facebook: (url, host) => {
        const parts = url.pathname.split('/');

        // Convert Facebook video URLs with ?v= parameter
        if (url.searchParams.get('v')) {
            url = new URL(`https://web.facebook.com/user/videos/${url.searchParams.get('v')}`);
        }
        // Convert fb.watch short URLs
        if (url.hostname === 'fb.watch') {
            url = new URL(`https://web.facebook.com/_shortLink/${parts[1]}`);
        }

        return url;
    },

    /**
     * Instagram URL aliasing
     * 
     * Handles:
     * - Alternative domains: ddinstagram.com, d.ddinstagram.com, g.ddinstagram.com -> instagram.com
     */
    instagram: (url, host) => {
        // Convert Instagram alternative domains to canonical instagram.com
        if (services.instagram.altDomains.includes(host.domain) && [null, 'd', 'g'].includes(host.subdomain)) {
            url.hostname = 'instagram.com';
        }

        return url;
    },

    /**
     * Xiaohongshu URL aliasing
     * 
     * Handles:
     * - xhslink.com short URLs -> xiaohongshu.com/...
     */
    xiaohongshu: (url, host) => {
        const parts = url.pathname.split('/');

        // Convert xiaohongshu short URLs
        if (url.hostname === 'xhslink.com' && parts.length === 3) {
            url = new URL(`https://www.xiaohongshu.com/${parts[1]}/${parts[2]}`);
        }

        return url;
    },

    /**
     * Reddit URL aliasing
     * 
     * Handles:
     * - v.redd.it short video URLs -> reddit.com/video/...
     */
    reddit: (url, host) => {
        const parts = url.pathname.split('/');

        // Convert Reddit short video URLs
        // reddit short video links can be treated by changing https://v.redd.it/<id>
        // to https://reddit.com/video/<id>
        if (url.hostname === "v.redd.it" && parts.length === 2) {
            url = new URL(`https://www.reddit.com/video/${parts[1]}`);
        }

        return url;
    },
};

/**
 * URL clean mapper registry
 * 
 * Maps service hostnames to their query parameter cleaning functions.
 * These functions keep only essential query parameters and remove the rest.
 * 
 * @type {Object<string, Function>}
 */
export const cleanMappers = {
    /**
     * YouTube query parameter cleaning
     * 
     * Keeps: ?v= (video ID)
     */
    youtube: (url) => {
        if (url.searchParams.get('v')) {
            url.search = `?v=${encodeURIComponent(url.searchParams.get('v'))}`;
            return false; // Don't strip query
        }
        return true; // Strip all query params
    },

    /**
     * Bilibili query parameter cleaning
     * 
     * Keeps: ?p= (part number for multi-part videos)
     */
    bilibili: (url) => {
        if (url.searchParams.get('p')) {
            url.search = `?p=${encodeURIComponent(url.searchParams.get('p'))}`;
            return false; // Don't strip query
        }
        return true; // Strip all query params
    },

    /**
     * Twitter query parameter cleaning
     * 
     * Keeps: ?post_id= (post ID for bookmark links)
     */
    twitter: (url) => {
        if (url.searchParams.get('post_id')) {
            url.search = `?post_id=${encodeURIComponent(url.searchParams.get('post_id'))}`;
            return false; // Don't strip query
        }
        return true; // Strip all query params
    },

    /**
     * Xiaohongshu query parameter cleaning
     * 
     * Keeps: ?xsec_token= (security token required for some links)
     */
    xiaohongshu: (url) => {
        if (url.searchParams.get('xsec_token')) {
            url.search = `?xsec_token=${encodeURIComponent(url.searchParams.get('xsec_token'))}`;
            return false; // Don't strip query
        }
        return true; // Strip all query params
    },
};

/**
 * Apply alias mapping to URL
 * 
 * @param {URL} url - URL to alias
 * @param {Object} host - Parsed hostname object from psl
 * @returns {URL} Aliased URL
 */
export function applyAliasMapping(url, host) {
    // Try service-specific alias mapper first
    const serviceMapper = aliasMappers[host.sld];
    if (serviceMapper) {
        return serviceMapper(url, host);
    }

    // Try alternative domain alias mappers
    // Some services have multiple alias mappers (e.g., youtube + youtu)
    const altMappers = {
        'vxtwitter': aliasMappers.twitter,
        'fixvx': aliasMappers.twitter,
        'x': aliasMappers.twitter,
        'fb': aliasMappers.facebook,
        'ddinstagram': aliasMappers.instagram,
    };

    const altMapper = altMappers[host.sld];
    if (altMapper) {
        return altMapper(url, host);
    }

    // No alias mapping needed
    return url;
}

/**
 * Apply clean mapping to URL
 * 
 * @param {URL} url - URL to clean
 * @param {string} hostSld - Service hostname (e.g., "youtube", "tiktok")
 * @returns {boolean} True if query params should be stripped, false otherwise
 */
export function applyCleanMapping(url, hostSld) {
    const cleanMapper = cleanMappers[hostSld];
    
    if (!cleanMapper) {
        return true; // Strip all query params by default
    }

    // Clean mapper returns true if query should be stripped, false otherwise
    return cleanMapper(url);
}

