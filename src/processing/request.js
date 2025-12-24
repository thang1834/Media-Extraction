import mime from "mime";
import ipaddr from "ipaddr.js";

import { apiSchema } from "./schema.js";
import { createProxyTunnels, createStream } from "../stream/manage.js";
import { NETWORK } from "../util/constants.js";
import { downloadFile, downloadFiles } from "../util/download-manager.js";
import { logger } from "../util/logger.js";

export async function createResponse(responseType, responseData) {
    const internalError = (code) => {
        return {
            status: 500,
            body: {
                status: "error",
                error: {
                    code: code || "error.api.fetch.critical.core",
                },
                critical: true
            }
        }
    }

    try {
        let status = 200,
            response = {};

        if (responseType === "error") {
            status = 400;
        }

        switch (responseType) {
            case "error":
                response = {
                    error: {
                        code: responseData?.code,
                        context: responseData?.context,
                    }
                }
                break;

            case "redirect":
                response = {
                    url: responseData?.url,
                    filename: responseData?.filename
                }
                break;

            case "tunnel":
                response = {
                    url: await createStream(responseData),
                    filename: responseData?.filename
                }
                break;

            case "local-processing":
                response = {
                    type: responseData?.type,
                    service: responseData?.service,
                    tunnel: await createProxyTunnels(responseData),

                    output: {
                        type: mime.getType(responseData?.filename) || undefined,
                        filename: responseData?.filename,
                        metadata: responseData?.fileMetadata || undefined,
                        subtitles: !!responseData?.subtitles || undefined,
                    },

                    audio: {
                        copy: responseData?.audioCopy,
                        format: responseData?.audioFormat,
                        bitrate: responseData?.audioBitrate,
                        cover: !!responseData?.cover || undefined,
                        cropCover: !!responseData?.cropCover || undefined,
                    },

                    isHLS: responseData?.isHLS,
                }

                if (!response.audio.format) {
                    if (response.type === "audio") {
                        // audio response without a format is invalid
                        return internalError();
                    }
                    delete response.audio;
                }

                if (!response.output.type || !response.output.filename) {
                    // response without a type or filename is invalid
                    return internalError();
                }
                break;

            case "picker":
                response = {
                    count: responseData?.picker?.length || 0,
                    picker: responseData?.picker,
                    audio: responseData?.url,
                    audioFilename: responseData?.filename
                }
                break;

            case "critical":
                return internalError(responseData?.code);

            default:
                throw "unreachable"
        }

        const responseBody = {
            status: responseType,
            ...response
        };
        
        /**
         * AUTO-DOWNLOAD FEATURE
         * 
         * When autoDownload is enabled, files are automatically downloaded to the server
         * instead of being returned to the client for manual download.
         * 
         * Use cases:
         * - Playlist downloads: Download all videos in a TikTok playlist
         * - Bulk operations: Download multiple files from a picker
         * - Server-side storage: Store files on server for later access
         * 
         * Folder structure:
         * - Single file: downloads/{service}/{username}/{filename}
         * - Playlist: downloads/{service}/{username}/{playlistName}/{filename}
         * 
         * The download happens asynchronously - the API response is returned immediately
         * while downloads continue in the background. Check server logs for progress.
         */
        if (responseData?.autoDownload) {
            const service = responseData?.service;
            
            /**
             * USERNAME EXTRACTION
             * 
             * Username is used to create organized folder structure on the server.
             * We try multiple sources because different services provide username in different places:
             * 
             * Priority order:
             * 1. responseData.username - Directly provided by service handler (most reliable)
             * 2. fileMetadata.author.uniqueId - From video metadata (TikTok, YouTube, etc.)
             * 3. fileMetadata.author.name - Fallback name if uniqueId not available
             * 
             * The @ prefix is removed to ensure clean folder names.
             */
            let username = responseData?.username || 
                            responseData?.fileMetadata?.author?.uniqueId ||
                            responseData?.fileMetadata?.author?.name;
            // Remove @ prefix if present (e.g., "@username" -> "username")
            if (username) {
                username = username.replace(/^@/, '');
            }
            
            /**
             * PLAYLIST NAME EXTRACTION
             * 
             * Playlist name is used to create nested folders for organized storage.
             * Example: downloads/tiktok/dmst2023/tình yêu lệch tuổi/video001.mp4
             * 
             * Playlist names may contain Unicode characters (Vietnamese, Chinese, etc.)
             * and are sanitized to be filesystem-safe while preserving the original characters.
             */
            const playlistName = responseData?.playlistName || '';
            
            logger.debug({ service, username, playlistName, hasPlaylistName: !!playlistName }, 'Auto-download with playlist info');
            
            /**
             * PICKER RESPONSE HANDLING
             * 
             * A picker response contains multiple files (e.g., playlist videos, Instagram carousel).
             * We download all items in the picker automatically.
             * 
             * Process:
             * 1. Filter valid items (must have URL and filename)
             * 2. Map to download format with metadata (videoId for retry logic)
             * 3. Download in batches with concurrency control
             * 4. Retry failed downloads with special handling for rate limits
             */
            if (responseType === "picker" && responseBody.picker) {
                /**
                 * Prepare files for download
                 * 
                 * Each item needs:
                 * - url: Download URL (may be tunnel URL for TikTok)
                 * - filename: Target filename on server
                 * - headers: HTTP headers (cookies, user-agent, etc.)
                 * - videoId: Video ID for retry logic (TikTok 404/403 errors)
                 * - index: Original position in playlist (for error reporting)
                 */
                const filesToDownload = responseBody.picker
                    .filter(item => item.url && item.filename) // Only download valid items
                    .map((item, index) => ({
                        url: item.url,
                        filename: item.filename,
                        headers: responseData?.headers,
                        videoId: item.videoId, // Critical for TikTok: enables 404/403 retry with fresh URL
                        index: index + 1, // 1-based index for user-friendly error messages
                    }));
                
                if (filesToDownload.length > 0) {
                    /**
                     * CONCURRENCY STRATEGY
                     * 
                     * We limit concurrent downloads to prevent:
                     * - Rate limiting (429 errors) from service providers
                     * - Server overload
                     * - Network congestion
                     * 
                     * Strategy:
                     * - Small batches (≤20 files): 3 concurrent downloads
                     * - Large batches (>20 files): 2 concurrent downloads
                     * 
                     * TikTok is particularly strict, so we're conservative with concurrency.
                     * Additional delays between batches (1s for TikTok, 500ms for others) further
                     * reduce the chance of hitting rate limits.
                     */
                    const concurrency = filesToDownload.length > 20 ? 2 : 3;
                    
                    /**
                     * START BATCH DOWNLOAD
                     * 
                     * downloadFiles handles:
                     * - Concurrent downloads with specified limit
                     * - Automatic retries for transient errors (404, 403 for TikTok)
                     * - Progress logging and final summary
                     * - Folder structure creation (service/username/playlistName/)
                     * 
                     * Timeout: 120 seconds (2 minutes) per file
                     * This is generous to handle large video files and slow connections.
                     */
                    downloadFiles(filesToDownload, {
                        concurrency,
                        timeout: 120000, // 2 minutes per file
                        service,
                        username,
                        playlistName,
                    }).then(results => {
                        /**
                         * POST-DOWNLOAD PROCESSING
                         * 
                         * After batch download completes, we analyze results:
                         * 1. Separate successful and failed downloads
                         * 2. Identify rate-limited files (429 errors) for special retry
                         * 3. Log other failures for debugging
                         * 
                         * Rate-limited files get special treatment because:
                         * - They're likely to succeed if we wait longer
                         * - Staggered retries prevent hitting rate limit again
                         * - Different from permanent failures (404, 403 without retry)
                         */
                        const failedDownloads = [];
                        results.forEach((result, i) => {
                            const file = filesToDownload[i];
                            if (!result.success) {
                                /**
                                 * RATE LIMITING DETECTION
                                 * 
                                 * HTTP 429 (Too Many Requests) indicates we're making
                                 * requests too quickly. These are temporary and can be
                                 * retried after a delay.
                                 * 
                                 * Strategy:
                                 * - Base delay: 10 seconds
                                 * - Staggered delay: +200ms per file index
                                 * - Example: File #1 waits 10.2s, File #2 waits 10.4s, etc.
                                 * 
                                 * This staggering prevents all retries from happening
                                 * simultaneously, which would hit the rate limit again.
                                 */
                                if (result.error && (result.error.includes('429') || result.error.includes('Too Many Requests'))) {
                                    failedDownloads.push({
                                        ...file,
                                        retryDelay: 10000 + (file.index * 200), // 10s base + staggered delay
                                    });
                                } else {
                                    /**
                                     * PERMANENT FAILURES
                                     * 
                                     * Other errors (404, 403 without retry, network errors, etc.)
                                     * are logged but not automatically retried here.
                                     * 
                                     * Note: TikTok 404/403 errors are already retried in download-manager.js
                                     * with fresh URL fetching. These are failures after all retries.
                                     */
                                    logger.warn({ 
                                        service, 
                                        username, 
                                        filename: file.filename,
                                        index: file.index,
                                        error: result.error 
                                    }, 'Auto-download picker item failed');
                                }
                            }
                        });
                        
                        /**
                         * RATE-LIMITED FILE RETRY
                         * 
                         * Files that failed due to rate limiting (429) are retried
                         * with longer delays and staggered timing.
                         * 
                         * Process:
                         * 1. Each file gets a unique delay based on its index
                         * 2. setTimeout schedules retries at different times
                         * 3. Each retry gets 3 additional attempts with 5s delays
                         * 4. Results are logged but don't block the main flow
                         * 
                         * Why this works:
                         * - Rate limits are usually time-based (e.g., X requests per minute)
                         * - Staggered retries spread requests over time
                         * - Longer delays give the rate limit window time to reset
                         * 
                         * Note: These retries happen asynchronously and don't affect
                         * the API response or other downloads.
                         */
                        if (failedDownloads.length > 0) {
                            logger.warn(`\n[WARNING] ${failedDownloads.length} files rate-limited, retrying with longer delays...\n`);
                            
                            failedDownloads.forEach((file, idx) => {
                                /**
                                 * Schedule retry with staggered delay
                                 * Each file waits a different amount of time to avoid
                                 * simultaneous retries that would hit rate limit again.
                                 */
                                setTimeout(() => {
                                    downloadFile(file.url, file.filename, {
                                        service,
                                        username,
                                        playlistName,
                                        headers: file.headers,
                                        timeout: 120000, // 2 minutes
                                        maxRetries: 3, // 3 additional retry attempts
                                        retryDelay: 5000, // 5 seconds between retries
                                    }).then(retryResult => {
                                        if (!retryResult.success) {
                                            /**
                                             * Retry still failed after all attempts
                                             * Log for debugging but don't throw error
                                             * (downloads are best-effort, not critical)
                                             */
                                            logger.warn(`[X] Retry failed: [${file.index}] ${file.filename.substring(0, 60)}... - ${retryResult.error}`);
                                        }
                                    }).catch(error => {
                                        /**
                                         * Unexpected error during retry (network, etc.)
                                         * Log for debugging
                                         */
                                        logger.error(`[X] Retry error: [${file.index}] ${file.filename.substring(0, 60)}... - ${error.message}`);
                                    });
                                }, file.retryDelay);
                            });
                        }
                    }).catch(error => {
                        /**
                         * BATCH DOWNLOAD ERROR
                         * 
                         * This catches errors in the downloadFiles function itself
                         * (not individual file failures, which are handled above).
                         * 
                         * Possible causes:
                         * - Network issues
                         * - File system errors
                         * - Unexpected exceptions in download logic
                         * 
                         * We log the error but don't throw - auto-download is best-effort
                         * and shouldn't break the API response.
                         */
                        logger.error({ 
                            err: error, 
                            service, 
                            username,
                            total: filesToDownload.length 
                        }, 'Auto-download batch error');
                    });
                }
            /**
             * SINGLE FILE DOWNLOAD HANDLING
             * 
             * For non-picker responses (tunnel or redirect), we download a single file.
             * This is simpler than batch downloads - no concurrency or retry logic needed.
             * 
             * Response types:
             * - tunnel: Proxy URL through server (e.g., TikTok tunnel URLs)
             * - redirect: Direct download URL (e.g., YouTube, Instagram)
             * 
             * The download happens asynchronously - API response is returned immediately.
             */
            } else if (responseBody.url && responseBody.filename) {
                /**
                 * Download single file
                 * 
                 * downloadFile handles:
                 * - Automatic retries for transient errors
                 * - Folder structure creation
                 * - Error logging
                 * 
                 * For TikTok videos, it will automatically retry 404/403 errors
                 * by fetching a fresh URL using the videoId (if provided).
                 */
                downloadFile(responseBody.url, responseBody.filename, {
                    service,
                    username,
                    playlistName,
                    headers: responseData?.headers,
                    timeout: 120000, // 2 minutes
                }).then(result => {
                    /**
                     * Download completed (success or failure)
                     * Log failure for debugging but don't throw error
                     */
                    if (!result.success) {
                        logger.warn({ 
                            service, 
                            username, 
                            filename: responseBody.filename,
                            error: result.error 
                        }, 'Auto-download failed');
                    }
                }).catch(error => {
                    /**
                     * Unexpected error during download
                     * (network issues, file system errors, etc.)
                     */
                    logger.error({ 
                        err: error, 
                        service, 
                        username, 
                        filename: responseBody.filename 
                    }, 'Auto-download error');
                });
            }
        }
        
        return {
            status,
            body: responseBody
        }
    } catch {
        return internalError();
    }
}

export function normalizeRequest(request) {
    // TODO: remove after backwards compatibility period
    if ("localProcessing" in request && typeof request.localProcessing === "boolean") {
        request.localProcessing = request.localProcessing ? "preferred" : "disabled";
    }

    return apiSchema.safeParseAsync(request).catch(() => (
        { success: false }
    ));
}

export function getIP(req, prefix = NETWORK.IP_PREFIX) {
    const strippedIP = req.ip.replace(/^::ffff:/, '');
    const ip = ipaddr.parse(strippedIP);
    if (ip.kind() === 'ipv4') {
        return strippedIP;
    }

    const v6Bytes = ip.toByteArray();
          v6Bytes.fill(0, prefix / 8);

    return ipaddr.fromByteArray(v6Bytes).toString();
}
