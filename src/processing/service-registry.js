/**
 * Service Registry
 * 
 * Centralized registry for service handlers and their parameter mapping logic.
 * This replaces the large switch statement in match.js, making it easier to
 * maintain and extend with new services.
 * 
 * Each service entry contains:
 * - paramsMapper: Function that maps patternMatch + request params to handler params
 * - preHandler: Optional function to execute before calling handler (e.g., YouTube Music logic)
 * - postHandler: Optional function to execute after calling handler (e.g., SoundCloud force audio)
 */

/**
 * Service registry configuration
 * 
 * @type {Object<string, Object>}
 */
export const serviceRegistry = {
    /**
     * Twitter/X service handler
     * 
     * Special handling:
     * - index is 1-based in URLs but 0-based in handler (subtract 1)
     */
    twitter: {
        paramsMapper: (patternMatch, params, context) => ({
            id: patternMatch.id,
            index: patternMatch.index - 1, // Convert 1-based to 0-based
            toGif: !!params.convertGif,
            alwaysProxy: params.alwaysProxy,
            dispatcher: context.dispatcher,
            subtitleLang: context.subtitleLang,
        }),
    },

    /**
     * Bilibili service handler
     * 
     * Simple pass-through: just pass patternMatch as-is
     */
    bilibili: {
        paramsMapper: (patternMatch) => patternMatch,
    },

    /**
     * YouTube service handler
     * 
     * Special handling:
     * - YouTube IDs are always 11 characters (slice to ensure)
     * - YouTube Music requires specific codec/quality settings
     * - Supports various codecs, containers, and quality options
     */
    youtube: {
        paramsMapper: (patternMatch, params, context) => {
            const { url, isAudioOnly, youtubeHLS, env } = context;
            
            let fetchInfo = {
                dispatcher: context.dispatcher,
                id: patternMatch.id.slice(0, 11), // YouTube IDs are always 11 characters
                quality: params.videoQuality,
                codec: params.youtubeVideoCodec,
                container: params.youtubeVideoContainer,
                isAudioOnly: context.isAudioOnly,
                isAudioMuted: context.isAudioMuted,
                dubLang: params.youtubeDubLang,
                youtubeHLS,
                subtitleLang: context.subtitleLang,
            };

            // Special handling for YouTube Music or audio-only requests
            // YouTube Music requires specific codec and quality settings
            if (url.hostname === "music.youtube.com" || isAudioOnly) {
                fetchInfo.quality = "1080"; // Use 1080p for better audio quality
                fetchInfo.codec = "vp9"; // VP9 codec for YouTube Music
                fetchInfo.isAudioOnly = true;
                fetchInfo.isAudioMuted = false;

                // Allow better audio quality if enabled and requested
                if (env.ytAllowBetterAudio && params.youtubeBetterAudio) {
                    fetchInfo.quality = "max"; // Use maximum available quality
                }
            }

            return fetchInfo;
        },
    },

    /**
     * Reddit service handler
     * 
     * Simple pass-through: spread patternMatch and add dispatcher
     */
    reddit: {
        paramsMapper: (patternMatch, params, context) => ({
            ...patternMatch,
            dispatcher: context.dispatcher,
        }),
    },

    /**
     * TikTok service handler
     * 
     * Special handling:
     * - Supports short links
     * - Supports user profiles (for multiple videos)
     * - fullAudio: Use original audio instead of watermarked version
     * - h265: Allow H.265/HEVC codec
     */
    tiktok: {
        paramsMapper: (patternMatch, params, context) => ({
            postId: patternMatch.postId,
            shortLink: patternMatch.shortLink, // TikTok short links
            user: patternMatch.user, // User profile (for multiple videos)
            playlistId: patternMatch.playlistId, // Playlist/Mix ID
            playlistName: patternMatch.playlistName, // Playlist/Mix name
            fullAudio: params.tiktokFullAudio,
            isAudioOnly: context.isAudioOnly,
            h265: params.allowH265,
            alwaysProxy: params.alwaysProxy,
            subtitleLang: context.subtitleLang,
            originalRequest: params.originalRequest || context.url?.href || context.url?.toString(), // Raw URL string for encoding preservation
        }),
    },

    /**
     * SoundCloud service handler
     * 
     * Special handling:
     * - SoundCloud is audio-only, so force audio mode
     * - This is handled in postHandler to update flags after handler call
     */
    soundcloud: {
        paramsMapper: (patternMatch, params) => ({
            ...patternMatch,
            format: params.audioFormat, // mp3, ogg, wav, opus, or best
        }),
        postHandler: (result, context) => {
            // SoundCloud is audio-only, so force audio mode
            // Update audioFlags object so changes are reflected in parent scope
            context.audioFlags.isAudioOnly = true;
            context.audioFlags.isAudioMuted = false;
            return result;
        },
    },

    /**
     * Instagram service handler
     * 
     * Supports posts, reels, and stories
     */
    instagram: {
        paramsMapper: (patternMatch, params, context) => ({
            ...patternMatch,
            quality: params.videoQuality,
            alwaysProxy: params.alwaysProxy,
            dispatcher: context.dispatcher,
        }),
    },

    /**
     * Facebook service handler
     * 
     * Public videos only
     */
    facebook: {
        paramsMapper: (patternMatch, params, context) => ({
            ...patternMatch,
            dispatcher: context.dispatcher,
        }),
    },

    /**
     * Xiaohongshu (Little Red Book) service handler
     * 
     * Chinese social media platform
     */
    xiaohongshu: {
        paramsMapper: (patternMatch, params, context) => ({
            ...patternMatch,
            h265: params.allowH265,
            isAudioOnly: context.isAudioOnly,
            dispatcher: context.dispatcher,
        }),
    },
};

/**
 * Get service configuration from registry
 * 
 * @param {string} host - Service hostname
 * @returns {Object|undefined} Service configuration or undefined if not found
 */
export function getServiceConfig(host) {
    return serviceRegistry[host];
}

/**
 * Check if service is registered
 * 
 * @param {string} host - Service hostname
 * @returns {boolean} True if service is registered
 */
export function isServiceRegistered(host) {
    return host in serviceRegistry;
}

