/**
 * Action Matching Module
 * 
 * This module determines the appropriate response type and processing method
 * based on the media type, user preferences, and service capabilities.
 * 
 * Response Types:
 * - redirect: Direct download URL (client downloads directly)
 * - tunnel: Proxy through server (server downloads and streams to client)
 * - picker: Multi-media selection UI (user chooses which media to download)
 * - local-processing: Server-side processing (merge, remux, convert, etc.)
 * 
 * Action Types:
 * - photo: Static image
 * - picker: Multiple media options
 * - gif: Animated GIF (may be converted to video)
 * - audio: Audio-only extraction
 * - muteVideo: Video without audio track
 * - hls: HLS stream processing
 * - video: Standard video
 */

import createFilename from "./create-filename.js";

import { createResponse } from "./request.js";
import { audioIgnore } from "./service-config.js";
import { createStream } from "../stream/manage.js";
import { splitFilenameExtension } from "../misc/utils.js";
import { convertLanguageCode } from "../misc/language-codes.js";
import { logger } from "../util/logger.js";

/**
 * Processing types that require server-side processing (not just proxying)
 * 
 * These operations need FFmpeg or other processing tools:
 * - merge: Combine separate video and audio streams
 * - remux: Re-package streams into different container (e.g., add subtitles)
 * - mute: Remove audio track from video
 * - audio: Extract/convert audio format
 * - gif: Convert video to animated GIF
 * 
 * Operations like "proxy" don't require processing - just forward the stream.
 */
const extraProcessingTypes = new Set(["merge", "remux", "mute", "audio", "gif"]);

/**
 * Determines action type and response format based on media and user preferences
 * 
 * @param {Object} options - Action matching options
 * @param {Object} options.r - Service handler result
 * @param {string} options.host - Service hostname
 * @param {string} options.audioFormat - Desired audio format
 * @param {boolean} options.isAudioOnly - Extract audio only
 * @param {boolean} options.isAudioMuted - Remove audio from video
 * @param {boolean} options.disableMetadata - Disable metadata extraction
 * @param {string} options.filenameStyle - Filename style preference
 * @param {boolean} options.convertGif - Convert GIFs to video
 * @param {string} options.requestIP - Request IP (for freebind)
 * @param {string} options.audioBitrate - Audio bitrate preference
 * @param {boolean} options.alwaysProxy - Always proxy through server
 * @param {string} options.localProcessing - Local processing mode
 * @returns {Object} Response object with status and body
 */
export default async function({
    r,
    host,
    audioFormat,
    isAudioOnly,
    isAudioMuted,
    disableMetadata,
    filenameStyle,
    convertGif,
    requestIP,
    audioBitrate,
    alwaysProxy,
    localProcessing,
    autoDownload = false,
    username = null,
}) {
    /**
     * ACTION TYPE DETERMINATION
     * 
     * Action type determines what kind of media we're processing.
     * This affects both the processing method and response format.
     */
    let action,
        /**
         * RESPONSE TYPE
         * 
         * Default is "tunnel" (proxy through server) for security and compatibility.
         * Can be changed to:
         * - "redirect": Direct download URL (faster, but exposes original URL)
         * - "picker": Multi-media selection (user chooses which files to download)
         * - "local-processing": Server processes media before sending (merge, convert, etc.)
         */
        responseType = "tunnel",
        /**
         * DEFAULT PARAMETERS
         * 
         * These parameters are common to all response types.
         * Service-specific parameters are added later in the switch statement.
         */
        defaultParams = {
            /**
             * Media URL(s)
             * Can be:
             * - String: Single URL (video or audio)
             * - Array: [videoUrl, audioUrl] for separate streams
             */
            url: r.urls,
            /**
             * HTTP headers needed for downloading
             * Typically includes cookies, user-agent, referer
             */
            headers: r.headers,
            /**
             * Service name (e.g., "tiktok", "youtube")
             * Used for folder structure in auto-download
             */
            service: host,
            /**
             * Filename generation
             * Priority: filenameAttributes (rich metadata) > provided filename
             * Rich filenames include title, author, date, etc.
             */
            filename: r.filenameAttributes ?
                    createFilename(r.filenameAttributes, filenameStyle, isAudioOnly, isAudioMuted) : r.filename,
            /**
             * Video metadata (title, author, description, etc.)
             * Only included if metadata extraction is enabled
             */
            fileMetadata: !disableMetadata ? r.fileMetadata : false,
            /**
             * Request IP for freebind (Linux only)
             * Allows binding to specific IP addresses
             */
            requestIP,
            /**
             * Original request URL
             * Preserved for encoding handling (especially for TikTok playlists)
             */
            originalRequest: r.originalRequest,
            /**
             * Subtitle tracks
             * Array of subtitle URLs with language codes
             */
            subtitles: r.subtitles,
            /**
             * Album/thumbnail cover image
             * Used for audio files with embedded artwork
             */
            cover: !disableMetadata ? r.cover : false,
            /**
             * Whether to crop cover to square
             * Some players prefer square album art
             */
            cropCover: !disableMetadata ? r.cropCover : false,
            /**
             * Playlist name for folder structure
             * Used in auto-download: downloads/{service}/{username}/{playlistName}/
             */
            playlistName: r.playlistName || '',
            /**
             * Username from service handler
             * May include @ prefix, will be cleaned later
             */
            username: r.username || null,
        },
        /**
         * SERVICE-SPECIFIC PARAMETERS
         * 
         * These are set in the switch statement based on action type and service.
         * Examples: processing type, special flags, service-specific options.
         */
        params = {
            autoDownload, // Pass through for auto-download feature
            username, // Pass through for folder structure
        };

    /**
     * ACTION TYPE DETERMINATION
     * 
     * Determine action type based on media type and user preferences.
     * Priority order is critical - we check most specific cases first.
     * 
     * Priority order:
     * 1. photo: Static image (simplest case)
     * 2. picker: Multiple media options (must check before other types)
     * 3. gif: Animated GIF conversion (only if user requested)
     * 4. audio: Audio-only extraction (user preference)
     * 5. muteVideo: Remove audio track (user preference)
     * 6. hls: HLS stream (requires special handling)
     * 7. video: Standard video (default fallback)
     */
    if (r.isPhoto) action = "photo";
    else if (r.picker) action = "picker"; // Multiple media options (Instagram carousel, Twitter multi-media, TikTok playlist)
    else if (r.isGif && convertGif) action = "gif"; // Convert animated GIF to video
    else if (isAudioOnly) action = "audio"; // Extract audio track only
    else if (isAudioMuted) action = "muteVideo"; // Remove audio track from video
    else if (r.isHLS) action = "hls"; // HLS (HTTP Live Streaming) requires special processing
    else action = "video"; // Standard video with audio

    /**
     * FILENAME HANDLING FOR SPECIAL ACTIONS
     * 
     * Some actions require filename modifications:
     * - Picker/Audio: Add audio format extension (.mp3, .m4a, etc.)
     * - MuteVideo: Add "_mute" suffix to distinguish from original
     * - GIF: Change extension to .gif
     */
    if (action === "picker" || action === "audio") {
        /**
         * Use audio filename if rich filename attributes aren't available
         * Audio files often have different naming conventions
         */
        if (!r.filenameAttributes) defaultParams.filename = r.audioFilename;
        /**
         * Add audio format to params
         * Will be appended to filename later (e.g., "song.mp3")
         */
        defaultParams.audioFormat = audioFormat;
    }

    /**
     * Filename modifications for special processing
     */
    if (action === "muteVideo" && isAudioMuted && !r.filenameAttributes) {
        /**
         * Add "_mute" suffix to distinguish muted videos
         * Example: "video.mp4" -> "video_mute.mp4"
         */
        const [ name, ext ] = splitFilenameExtension(r.filename);
        defaultParams.filename = `${name}_mute.${ext}`;
    } else if (action === "gif") {
        /**
         * Change extension to .gif for GIF conversions
         * Example: "video.mp4" -> "video.gif"
         */
        const [ name ] = splitFilenameExtension(r.filename);
        defaultParams.filename = `${name}.gif`;
    }

    /**
     * PROCESSING PARAMETER DETERMINATION
     * 
     * Based on action type, determine:
     * - Processing type (proxy, merge, remux, audio, etc.)
     * - Response type (redirect, tunnel, picker, local-processing)
     * - Service-specific handling
     */
    switch (action) {
        default:
            /**
             * Unknown action type - should never happen
             * Indicates a bug in action determination logic
             */
            return createResponse("error", {
                code: "error.api.fetch.empty"
            });

        case "photo":
            /**
             * PHOTO HANDLING
             * 
             * Photos are simple - just proxy the image through server.
             * No processing needed, just forward the stream.
             */
            params = { type: "proxy" };
            break;

        case "gif":
            /**
             * GIF CONVERSION
             * 
             * Convert video to animated GIF.
             * Requires FFmpeg processing to extract frames and create GIF.
             */
            params = { type: "gif" };
            break;

        case "hls":
            /**
             * HLS (HTTP Live Streaming) HANDLING
             * 
             * HLS streams are split into segments and need special processing:
             * - Multiple URLs: Merge all segments into single file
             * - Single URL: Remux (re-package) into standard container
             * 
             * HLS is complex because it requires:
             * - Downloading manifest (.m3u8)
             * - Downloading all segments
             * - Merging segments in correct order
             */
            params = {
                type: Array.isArray(r.urls) ? "merge" : "remux",
                isHLS: true,
            }
            break;

        case "muteVideo":
            /**
             * MUTE VIDEO HANDLING
             * 
             * Remove audio track from video.
             * 
             * Optimization: If video and audio are separate streams (array URLs),
             * we can just proxy the video URL without processing.
             * Otherwise, we need FFmpeg to remove the audio track.
             */
            let muteType = "mute";
            /**
             * Check if we can optimize by using video URL directly
             * Only works if:
             * - URLs are separate (array format: [videoUrl, audioUrl])
             * - Not HLS (HLS requires processing regardless)
             */
            if (Array.isArray(r.urls) && !r.isHLS) {
                muteType = "proxy"; // No processing needed - just use video stream
            }
            params = {
                type: muteType,
                /**
                 * Use video URL only (first element if array)
                 * Audio URL (second element) is ignored for muted videos
                 */
                url: Array.isArray(r.urls) ? r.urls[0] : r.urls,
                isHLS: r.isHLS
            }
            /**
             * Reddit special case
             * Reddit sometimes returns direct URLs that can be redirected
             * (no need to proxy through server)
             */
            if (host === "reddit" && r.typeId === "redirect") {
                responseType = "redirect";
            }
            break;

        case "picker":
            /**
             * PICKER HANDLING
             * 
             * Picker allows user to select from multiple media options.
             * Common use cases:
             * - Instagram carousel posts (multiple photos/videos)
             * - Twitter multi-media tweets
             * - TikTok playlists (multiple videos)
             * - Xiaohongshu multi-image posts
             * 
             * Response type is always "picker" - client shows selection UI.
             */
            responseType = "picker";
            switch (host) {
                case "instagram":
                case "twitter":
                case "xiaohongshu":
                    /**
                     * SIMPLE PICKER
                     * 
                     * These services return picker items with direct URLs.
                     * No special processing needed - just return the picker array.
                     */
                    params = { picker: r.picker };
                    break;

                case "tiktok":
                    /**
                     * TIKTOK PICKER HANDLING
                     * 
                     * TikTok requires special handling:
                     * 1. All video URLs must be tunnel URLs (for security and URL expiration handling)
                     * 2. Audio option needs special format detection
                     * 3. Username must be passed for auto-download folder structure
                     */
                    
                    /**
                     * AUDIO STREAM TYPE DETERMINATION
                     * 
                     * TikTok provides original audio in MP3 format.
                     * If user wants "best" format and TikTok's best is MP3,
                     * we can proxy it directly without conversion (faster).
                     */
                    let audioStreamType = "audio";
                    if (r.bestAudio === "mp3" && audioFormat === "best") {
                        audioFormat = "mp3";
                        audioStreamType = "proxy"; // Direct proxy, no conversion needed
                    }
                    
                    /**
                     * CREATE TUNNEL URLs FOR ALL VIDEOS
                     * 
                     * TikTok URLs expire quickly, so we wrap them in tunnel URLs.
                     * Tunnel URLs:
                     * - Re-fetch the underlying URL on each access
                     * - Handle URL expiration automatically
                     * - Provide signed, secure access
                     * 
                     * Process:
                     * 1. Check if URL is already a tunnel URL (skip if so)
                     * 2. Validate URL exists and is a string
                     * 3. Create tunnel URL for each video
                     * 4. Filter out invalid items
                     */
                    const pickerWithTunnels = await Promise.all(
                        (r.picker || []).map(async (item) => {
                            /**
                             * Skip if already a tunnel URL
                             * (may have been created by service handler)
                             */
                            if (item.url && typeof item.url === 'string' && item.url.includes('/tunnel?')) {
                                return item;
                            }
                            
                            /**
                             * Validate URL exists and is a string
                             * Invalid items are filtered out later
                             */
                            if (!item.url || typeof item.url !== 'string') {
                                logger.warn({ filename: item.filename }, 'Picker item missing valid URL, skipping');
                                return null;
                            }
                            
                            /**
                             * Create tunnel URL for this video
                             * Tunnel URLs are signed and have expiration time
                             */
                            const tunnelUrl = await createStream({
                                service: "tiktok",
                                type: "proxy",
                                url: item.url,
                                filename: item.filename,
                                headers: r.headers
                            });
                            
                            return {
                                ...item,
                                url: tunnelUrl
                            };
                        })
                    );
                    
                    /**
                     * Filter out null items (items without valid URLs)
                     * These are logged but don't break the entire picker
                     */
                    const validPicker = pickerWithTunnels.filter(item => item !== null);
                    
                    params = {
                        /**
                         * Video/image options with tunnel URLs
                         * Each item has: type, url (tunnel), filename, thumb, videoId
                         */
                        picker: validPicker,
                        /**
                         * Audio option stream URL
                         * Created separately because it may need format conversion
                         */
                        url: createStream({
                            service: "tiktok",
                            type: audioStreamType,
                            url: r.urls,
                            headers: r.headers,
                            filename: `${r.audioFilename}.${audioFormat}`,
                            isAudioOnly: true,
                            audioFormat,
                            audioBitrate
                        }),
                        /**
                         * Username for auto-download folder structure
                         * Priority: function parameter > service handler result
                         */
                        username: username || r.username,
                    }
                    break;
            }
            break;

        case "video":
            /**
             * VIDEO PROCESSING
             * 
             * Video processing varies significantly by service.
             * Each service has different:
             * - Stream formats (separate video/audio vs combined)
             * - Container formats (mp4, webm, mkv, etc.)
             * - Security requirements (cookies, headers, etc.)
             * - Response type preferences (redirect vs tunnel)
             */
            switch (host) {
                case "bilibili":
                    /**
                     * Bilibili videos are often split into multiple parts
                     * Need to merge video and audio streams
                     */
                    params = { type: "merge" };
                    break;

                case "youtube":
                    /**
                     * YouTube handler determines processing type
                     * Can be: "merge", "remux", or "proxy"
                     * Depends on codec, container, and quality settings
                     */
                    params = { type: r.type };
                    break;

                case "reddit":
                    /**
                     * Reddit can return different response types
                     * Some videos can be redirected directly (faster)
                     * Others need tunneling (for security/headers)
                     */
                    responseType = r.typeId; // "redirect" or "tunnel"
                    params = { type: r.type };
                    break;

                case "twitter":
                    /**
                     * Twitter processing
                     * - Remux if needed (e.g., to add metadata)
                     * - Redirect otherwise (direct download is faster)
                     */
                    if (r.type === "remux") {
                        params = { type: r.type };
                    } else {
                        responseType = "redirect";
                    }
                    break;

                case "tiktok":
                    /**
                     * TikTok processing
                     * - Remux if subtitles need to be added (requires FFmpeg)
                     * - Proxy otherwise (just forward the stream)
                     * 
                     * TikTok URLs are always proxied through tunnel for:
                     * - Security (signed URLs)
                     * - URL expiration handling
                     * - Cookie management
                     */
                    params = {
                        type: r.subtitles ? "remux" : "proxy"
                    };
                    break;

                case "xiaohongshu":
                    /**
                     * Xiaohongshu (Little Red Book)
                     * Simple proxy - no processing needed
                     */
                    params = { type: "proxy" };
                    break;

                case "facebook":
                case "instagram":
                    /**
                     * Facebook and Instagram
                     * These services allow direct redirect (no tunneling needed)
                     * Faster for users, but exposes original URL
                     */
                    responseType = "redirect";
                    break;
            }
            break;

        case "audio":
            /**
             * AUDIO EXTRACTION
             * 
             * Extract audio track from video or download audio-only file.
             * 
             * Some services don't support audio extraction:
             * - Services in audioIgnore set (e.g., Facebook)
             * - Reddit with redirect type (no processing capability)
             */
            if (audioIgnore.has(host) || (host === "reddit" && r.typeId === "redirect")) {
                return createResponse("error", {
                    code: "error.api.service.audio_not_supported"
                })
            }

            /**
             * PROCESSING TYPE DETERMINATION
             * 
             * Default: "audio" (process/convert audio)
             * Can be optimized to "proxy" if format matches and no conversion needed
             */
            let processType = "audio"; // Default: process audio (convert/transcode)
            let copy = false; // Whether to copy stream without re-encoding (faster)

            /**
             * AUDIO FORMAT HANDLING
             * 
             * If user wants "best" format, we try to use the service's native format.
             * This avoids unnecessary conversion and is faster.
             */
            if (audioFormat === "best") {
                const serviceBestAudio = r.bestAudio;

                if (serviceBestAudio) {
                    /**
                     * Service provides best format - use it directly
                     * No processing needed, just proxy the stream
                     */
                    audioFormat = serviceBestAudio;
                    processType = "proxy";

                    /**
                     * SoundCloud special case
                     * Even if best format, we still process to:
                     * - Add metadata
                     * - Ensure consistent format
                     * - Handle private links
                     */
                    if (host === "soundcloud") {
                        processType = "audio";
                        copy = true; // Copy stream without re-encoding (faster)
                    }
                } else {
                    /**
                     * No best format specified
                     * Default to m4a (widely compatible)
                     * Copy if already m4a, convert otherwise
                     */
                    audioFormat = "m4a";
                    copy = true;
                }
            }

            /**
             * HLS STREAMS
             * 
             * HLS always needs processing because:
             * - Segments must be downloaded and merged
             * - Can't just copy individual segments
             */
            if (r.isHLS) {
                copy = false;
                processType = "audio";
            }

            params = {
                type: processType,
                /**
                 * Use audio URL
                 * If URLs are separate: use second element (audio)
                 * If single URL: use the URL itself
                 */
                url: Array.isArray(r.urls) ? r.urls[1] : r.urls,

                audioBitrate,
                /**
                 * audioCopy: Whether to copy stream without re-encoding
                 * - true: Faster, preserves quality, but requires format match
                 * - false: Slower, re-encodes, but always works
                 */
                audioCopy: copy,
                audioFormat,

                isHLS: r.isHLS,
            }
            break;
    }

    /**
     * FILENAME EXTENSION HANDLING
     * 
     * Add audio format extension to filename for picker and audio actions.
     * Example: "song" -> "song.mp3" or "song.m4a"
     */
    if (defaultParams.filename && (action === "picker" || action === "audio")) {
        defaultParams.filename += `.${audioFormat}`;
    }

    /**
     * FORCE PROXY HANDLING
     * 
     * If alwaysProxy is set (e.g., when localProcessing is forced),
     * convert redirect responses to tunnel responses.
     * 
     * This ensures all downloads go through server, which is needed for:
     * - Local processing
     * - Security (hiding original URLs)
     * - Cookie management
     */
    if (alwaysProxy && responseType === "redirect") {
        responseType = "tunnel";
        params.type = "proxy";
    }

    /**
     * LOCAL PROCESSING DETERMINATION
     * 
     * Local processing means server downloads and processes media before sending to client.
     * This is useful for:
     * - Slow client connections (server does heavy lifting)
     * - Processing-intensive operations (merge, remux, convert)
     * - Ensuring consistent output format
     * 
     * Conditions:
     * - Not HLS (HLS local processing is complex and not yet supported)
     * - Not picker (picker requires client-side selection)
     * - Either forced OR preferred with extra processing needed
     * 
     * TODO: Add support for HLS local processing (requires segment management)
     */
    if (!params.isHLS && responseType !== "picker") {
        /**
         * Check if local processing should be used
         * - forced: Always use local processing
         * - preferred: Use only if extra processing is needed (merge, remux, etc.)
         */
        const isPreferredWithExtra =
            localProcessing === "preferred" && extraProcessingTypes.has(params.type);

        if (localProcessing === "forced" || isPreferredWithExtra) {
            responseType = "local-processing";
        }
    }

    /**
     * SUBTITLE LANGUAGE CODE CONVERSION
     * 
     * Convert subtitle language codes from ISO 639-1 (2 chars) to ISO 639-2 (3 chars).
     * 
     * Examples:
     * - "en" (ISO 639-1) -> "eng" (ISO 639-2)
     * - "vi" -> "vie"
     * 
     * Video players typically expect ISO 639-2 format for subtitle language codes.
     * If conversion fails, remove the language code entirely (better than invalid code).
     */
    const sublanguage = defaultParams.fileMetadata?.sublanguage;
    if (sublanguage && sublanguage.length !== 3) {
        const code = convertLanguageCode(sublanguage);
        if (code) {
            defaultParams.fileMetadata.sublanguage = code;
        } else {
            /**
             * Conversion failed - remove language code
             * Better to have no language than an invalid one
             */
            delete defaultParams.fileMetadata.sublanguage;
        }
    }

    /**
     * AUTO-DOWNLOAD AND USERNAME HANDLING
     * 
     * Prepare response data with auto-download flags and username.
     * These are used by request.js to trigger automatic downloads.
     */
    const finalAutoDownload = autoDownload; // Already mapped from downloadMode in match.js
    /**
     * Username priority:
     * 1. defaultParams.username (from service handler - most reliable)
     * 2. username (function parameter)
     * 3. params.username (service-specific parameter)
     */
    const finalUsername = defaultParams.username || username || params.username;
    
    /**
     * Combine all parameters into final response data
     * defaultParams are merged first, then params override them
     */
    const responseData = { 
        ...defaultParams, 
        ...params,
        /**
         * Ensure autoDownload and username are explicitly set
         * These are critical for auto-download feature
         */
        autoDownload: finalAutoDownload,
        username: finalUsername,
        /**
         * Keep playlistName from defaultParams
         * This comes from service handler and is needed for folder structure
         */
        playlistName: defaultParams.playlistName,
    };
    
    /**
     * Log auto-download activation for debugging
     */
    if (finalAutoDownload) {
        logger.debug({ 
            host, 
            autoDownload: finalAutoDownload, 
            username: finalUsername,
            responseType 
        }, 'Auto-download enabled in match-action');
    }
    
    /**
     * USERNAME EXTRACTION FALLBACK
     * 
     * If username wasn't set yet but auto-download is enabled,
     * try to extract it from file metadata.
     * 
     * This is a fallback for services that don't provide username directly.
     */
    if (responseData.autoDownload && !responseData.username) {
        /**
         * Try to extract username from file metadata
         * Priority: uniqueId (most reliable) > name (fallback)
         */
        if (responseData.fileMetadata?.author?.uniqueId) {
            responseData.username = responseData.fileMetadata.author.uniqueId;
        } else if (responseData.fileMetadata?.author?.name) {
            responseData.username = responseData.fileMetadata.author.name;
        }
    }
    
    // Create and return response
    return await createResponse(
        responseType,
        responseData
    );
}
