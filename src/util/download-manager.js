import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { env } from '../config.js';
import { USER_AGENT } from './constants.js';
import { getHeaders } from '../stream/shared.js';

const genericUserAgent = USER_AGENT;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default download directory
const DEFAULT_DOWNLOAD_DIR = path.join(__dirname, '../../downloads');
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || DEFAULT_DOWNLOAD_DIR;

// Cleanup configuration
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const FILE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Ensure download directory exists
 */
async function ensureDownloadDir() {
    try {
        await fs.access(DOWNLOAD_DIR);
    } catch {
        await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
        logger.debug({ downloadDir: DOWNLOAD_DIR }, 'Created download directory');
    }
}

/**
 * Download file from URL and save to disk with retry logic
 * 
 * @param {string} url - URL to download from
 * @param {string} filename - Filename to save as
 * @param {Object} options - Download options
 * @param {Object} options.headers - HTTP headers
 * @param {number} options.timeout - Request timeout in ms
 * @param {string} options.service - Service name (e.g., "tiktok", "youtube")
 * @param {string} options.username - Username or ID for subfolder (e.g., "st.1834")
 * @param {string} options.playlistName - Playlist name for subfolder (e.g., "My Playlist")
 * @param {number} options.maxRetries - Maximum number of retries (default: 2)
 * @param {number} options.retryDelay - Delay between retries in ms (default: 2000)
 * @returns {Promise<{success: boolean, filepath: string, size: number, error?: string}>}
 */
export async function downloadFile(url, filename, options = {}) {
    const { maxRetries = 2, retryDelay = 2000, ...downloadOptions } = options;
    
    let lastError = null;
    let currentUrl = url;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await downloadFileAttempt(currentUrl, filename, downloadOptions);
        
        if (result.success) {
            return result;
        }
        
        lastError = result;
        
        /**
         * Special handling for TikTok 404/403 errors: Fetch fresh URL from videoId
         * TikTok URLs expire very quickly, so we need to get a new URL when download fails
         */
        if (result.error && (result.error.includes('404') || result.error.includes('403')) && downloadOptions.service === 'tiktok' && downloadOptions.videoId) {
            try {
                const freshUrl = await fetchTikTokVideoUrl(downloadOptions.videoId, downloadOptions.headers);
                if (freshUrl && freshUrl !== currentUrl) {
                    currentUrl = freshUrl;
                    // Retry immediately with fresh URL (no delay needed since we have fresh URL)
                    const retryResult = await downloadFileAttempt(freshUrl, filename, downloadOptions);
                    if (retryResult.success) {
                        return retryResult;
                    }
                    lastError = retryResult;
                    // Continue loop for additional retries if needed
                    continue;
                }
            } catch (e) {
                logger.warn({ videoId: downloadOptions.videoId, error: e.message, httpError: result.error }, 'Failed to fetch fresh TikTok URL for retry');
            }
        }
        
        /**
         * Don't retry 403 errors for non-TikTok services or TikTok without videoId
         * 403 Forbidden usually means permanent access denial
         */
        if (result.error && result.error.includes('403') && (downloadOptions.service !== 'tiktok' || !downloadOptions.videoId)) {
            return result;
        }
        
        /**
         * Retry with exponential backoff
         * Skip logging for rate limit errors (429) - they're handled separately
         */
        if (attempt < maxRetries) {
            const delay = retryDelay * (attempt + 1); // Exponential backoff
            if (!result.error?.includes('429') && !result.error?.includes('Too Many Requests')) {
                logger.debug(`Retrying download (${attempt + 1}/${maxRetries}): ${filename.substring(0, 50)}...`);
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return {
        success: false,
        filepath: lastError?.filepath || '',
        size: 0,
        error: lastError?.error || 'Download failed after retries',
    };
}

/**
 * Get download path for a file
 * Creates nested directory structure: downloads/{service}/{username}/{playlistName}/
 * 
 * @param {string} filename - Filename to save
 * @param {string} service - Service name (e.g., "tiktok", "youtube")
 * @param {string} username - Username for subfolder
 * @param {string} playlistName - Playlist name for subfolder (optional)
 * @returns {Promise<string>} Full file path
 */
async function getDownloadPath(filename, service, username, playlistName) {
    let downloadPath = DOWNLOAD_DIR;
    if (service) {
        downloadPath = path.join(downloadPath, service);
        if (username) {
            /**
             * Sanitize username to be filesystem-safe
             * Only remove characters invalid for filesystem, preserve Unicode (Vietnamese, Chinese, etc.)
             */
            const safeUsername = username.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
            downloadPath = path.join(downloadPath, safeUsername);
            
            /**
             * Add playlist name if provided
             * Creates nested folder: downloads/tiktok/username/playlistName/
             */
            if (playlistName && playlistName.trim()) {
                const safePlaylistName = playlistName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
                downloadPath = path.join(downloadPath, safePlaylistName);
            }
        }
    }
    
    // Ensure subfolder exists
    try {
        await fs.access(downloadPath);
    } catch {
        await fs.mkdir(downloadPath, { recursive: true });
    }
    
    return path.join(downloadPath, filename);
}

/**
 * Fetch fresh TikTok video URL from videoId
 * Used when download fails with 404/403 to get a new, valid URL
 * 
 * @param {string} videoId - TikTok video ID
 * @param {Object} headers - HTTP headers (should include cookies)
 * @returns {Promise<string|null>} Fresh video URL or null if fetch fails
 */
async function fetchTikTokVideoUrl(videoId, headers = {}) {
    try {
        const cookie = headers.cookie || headers.Cookie || '';
        /**
         * Merge with service headers to ensure all required headers are present
         * TikTok requires user-agent and referer headers
         */
        const serviceHeaders = getHeaders('tiktok') || {};
        const res = await fetch(`https://www.tiktok.com/@i/video/${videoId}`, {
            headers: {
                "user-agent": serviceHeaders['user-agent'] || genericUserAgent,
                "referer": serviceHeaders.referer || "https://www.tiktok.com/",
                cookie,
            }
        });
        
        if (res.status === 200) {
            const html = await res.text();
            const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.+?)<\/script>/s);
            if (jsonMatch) {
                const detail = JSON.parse(jsonMatch[1])?.["__DEFAULT_SCOPE__"]?.["webapp.video-detail"]?.itemInfo?.itemStruct;
                
                /**
                 * Extract video URL from various possible structures
                 * TikTok API response structure can vary
                 */
                let videoUrl = detail?.video?.playAddr?.urlList?.[0];
                if (!videoUrl && detail?.video?.playAddr) {
                    if (typeof detail.video.playAddr === 'object') {
                        if (detail.video.playAddr.urlList && Array.isArray(detail.video.playAddr.urlList) && detail.video.playAddr.urlList.length > 0) {
                            videoUrl = detail.video.playAddr.urlList[0];
                        } else if (detail.video.playAddr.url && typeof detail.video.playAddr.url === 'string') {
                            videoUrl = detail.video.playAddr.url;
                        } else if (typeof detail.video.playAddr === 'string') {
                            videoUrl = detail.video.playAddr;
                        }
                    } else if (typeof detail.video.playAddr === 'string') {
                        videoUrl = detail.video.playAddr;
                    }
                }
                
                /**
                 * Fallback to downloadAddr if playAddr doesn't have valid URL
                 */
                if (!videoUrl || typeof videoUrl !== 'string') {
                    const downloadAddr = detail?.video?.downloadAddr;
                    if (downloadAddr) {
                        if (typeof downloadAddr === 'object') {
                            if (downloadAddr.urlList && Array.isArray(downloadAddr.urlList) && downloadAddr.urlList.length > 0) {
                                videoUrl = downloadAddr.urlList[0];
                            } else if (downloadAddr.url && typeof downloadAddr.url === 'string') {
                                videoUrl = downloadAddr.url;
                            }
                        } else if (typeof downloadAddr === 'string') {
                            videoUrl = downloadAddr;
                        }
                    }
                }
                
                if (videoUrl && typeof videoUrl === 'string') {
                    return videoUrl;
                }
            }
        }
    } catch (e) {
        logger.warn({ videoId, error: e.message }, 'Failed to fetch fresh TikTok URL');
    }
    return null;
}

/**
 * Single download attempt (internal function)
 * Performs the actual HTTP request and file write
 * 
 * @param {string} url - URL to download from
 * @param {string} filename - Filename to save as
 * @param {Object} options - Download options
 * @returns {Promise<{success: boolean, filepath: string, size: number, error?: string}>}
 */
async function downloadFileAttempt(url, filename, options = {}) {
    await ensureDownloadDir();
    
    const { headers = {}, timeout = 30000, service, username, playlistName } = options;
    const filepath = await getDownloadPath(filename, service, username, playlistName);
    
    try {
        /**
         * Fetch file with timeout support
         */
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, {
            headers,
            signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        /**
         * Get expected file size from Content-Length header
         * Used for validation and progress tracking
         */
        const contentLength = response.headers.get('content-length');
        const expectedSize = contentLength ? parseInt(contentLength, 10) : null;
        
        /**
         * Download file into memory buffer
         * For large files, consider streaming to disk instead
         */
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Write buffer to file
        await fs.writeFile(filepath, buffer);
        
        // Get actual file size for verification
        const stats = await fs.stat(filepath);
        const actualSize = stats.size;
        
        return {
            success: true,
            filepath,
            size: actualSize,
            expectedSize,
        };
        
    } catch (error) {
        /**
         * Clean up partial file if download failed
         * Prevents corrupted files from remaining on disk
         */
        try {
            await fs.unlink(filepath);
        } catch {
            // File doesn't exist or already deleted - ignore
        }
        
        return {
            success: false,
            filepath,
            size: 0,
            error: error.message,
        };
    }
}

/**
 * Download multiple files
 * 
 * @param {Array<{url: string, filename: string, headers?: Object}>} files - Array of files to download
 * @param {Object} options - Download options
 * @param {number} options.concurrency - Number of concurrent downloads
 * @param {number} options.timeout - Request timeout in ms
 * @param {string} options.service - Service name (e.g., "tiktok", "youtube")
 * @param {string} options.username - Username or ID for subfolder
 * @param {string} options.playlistName - Playlist name for subfolder
 * @returns {Promise<Array>} Array of download results
 */
/**
 * Format download progress as a table-like string
 * Used for console output (currently unused, kept for future use)
 * 
 * @param {number} completed - Number of completed downloads
 * @param {number} total - Total number of files
 * @param {number} success - Number of successful downloads
 * @param {number} failed - Number of failed downloads
 * @param {string} currentBatch - Current batch description (optional)
 * @returns {string} Formatted progress table
 */
function formatProgressTable(completed, total, success, failed, currentBatch = null) {
    const percentage = Math.round((completed / total) * 100);
    const barLength = 20;
    const filled = Math.round((completed / total) * barLength);
    const bar = '#'.repeat(filled) + '-'.repeat(barLength - filled);
    
    let table = `\n+-----------------------------------------------------------+\n`;
    table += `| Download Progress: ${completed.toString().padStart(3)}/${total} (${percentage}%) |\n`;
    table += `| [${bar}] |\n`;
    table += `| [OK] Success: ${success.toString().padStart(3)}  [X] Failed: ${failed.toString().padStart(3)}  |\n`;
    if (currentBatch) {
        table += `| Current Batch: ${currentBatch} |\n`;
    }
    table += `+-----------------------------------------------------------+\n`;
    
    return table;
}

export async function downloadFiles(files, options = {}) {
    const { concurrency = 3, timeout = 30000, service, username, playlistName } = options;
    
    const results = [];
    const startTime = Date.now();
    
    /**
     * Download files in batches to avoid overwhelming the system
     * Concurrent downloads are limited to prevent rate limiting
     */
    for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        const batchPromises = batch.map((file, batchIndex) => 
            downloadFile(file.url, file.filename, {
                headers: file.headers,
                timeout,
                service,
                username,
                playlistName,
                videoId: file.videoId, // Pass videoId for TikTok 404/403 retry logic
            })
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        /**
         * Add delay between batches to avoid rate limiting
         * TikTok is more strict, so we use longer delays (1s vs 500ms)
         */
        if (i + concurrency < files.length) {
            const delay = service === 'tiktok' ? 1000 : 500; // 1s for TikTok, 500ms for others
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgTime = (duration / files.length).toFixed(2);
    
    /**
     * Collect failed download indices for summary
     * Helps identify which files failed in large batches
     */
    const failedIndices = results
        .map((r, idx) => ({ success: r.success, index: idx + 1 }))
        .filter(r => !r.success)
        .map(r => r.index);
    
    /**
     * Log final download summary
     * Shows total files, success/failure counts, failed indices, and duration
     */
    logger.info(`\n===========================================================`);
    logger.info(`  Download Summary`);
    logger.info(`===========================================================`);
    logger.info(`  Total Files:    ${files.length}`);
    logger.info(`  [OK] Success:     ${successCount}`);
    if (failedCount > 0) {
        logger.info(`  [X] Failed:      ${failedCount}`);
        // In danh sách index bị fail
        if (failedIndices.length <= 20) {
            logger.info(`  Failed indices: ${failedIndices.join(', ')}`);
        } else {
            // Nếu nhiều hơn 20, chỉ in một phần
            logger.info(`  Failed indices: ${failedIndices.slice(0, 20).join(', ')} ... (${failedIndices.length} total)`);
        }
    }
    logger.info(`  Duration:    ${duration}s (avg: ${avgTime}s/file)`);
    logger.info(`===========================================================\n`);
    
    /**
     * Log detailed error information for failed files
     * Only show details if there are 10 or fewer failures (to avoid log spam)
     */
    if (failedCount > 0) {
        const failedFiles = results
            .map((r, idx) => ({ result: r, file: files[idx], index: idx + 1 }))
            .filter(({ result }) => !result.success);
        
        if (failedFiles.length <= 10) {
            // Log detailed error for each failed file
            logger.warn(`Failed files (${failedFiles.length}):`);
            failedFiles.forEach(({ result, file, index }) => {
                logger.warn(`  [${index.toString().padStart(3)}/${files.length}] ${file.filename} - ${result.error}`);
            });
        } else {
            // Too many failures - just log summary
            logger.warn(`Failed files: ${failedFiles.length} files (too many to list individually)`);
        }
    }
    
    return results;
}

/**
 * Get file info
 * 
 * @param {string} filename - Filename
 * @returns {Promise<{exists: boolean, size?: number, created?: Date, modified?: Date}>}
 */
export async function getFileInfo(filename) {
    const filepath = path.join(DOWNLOAD_DIR, filename);
    
    try {
        const stats = await fs.stat(filepath);
        return {
            exists: true,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
        };
    } catch {
        return {
            exists: false,
        };
    }
}

/**
 * List all files in download directory
 * 
 * @param {Object} options - List options
 * @param {number} options.maxAge - Maximum file age in ms (for filtering)
 * @returns {Promise<Array<{filename: string, size: number, created: Date, modified: Date}>>}
 */
export async function listFiles(options = {}) {
    await ensureDownloadDir();
    
    const { maxAge } = options;
    const now = Date.now();
    
    try {
        const files = await fs.readdir(DOWNLOAD_DIR);
        const fileInfos = [];
        
        for (const filename of files) {
            const filepath = path.join(DOWNLOAD_DIR, filename);
            
            try {
                const stats = await fs.stat(filepath);
                
                // Skip if file is too old
                if (maxAge && (now - stats.mtime.getTime()) > maxAge) {
                    continue;
                }
                
                // Skip directories
                if (stats.isDirectory()) {
                    continue;
                }
                
                fileInfos.push({
                    filename,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime,
                });
            } catch {
                // Skip files we can't stat
                continue;
            }
        }
        
        // Sort by modified date (newest first)
        fileInfos.sort((a, b) => b.modified - a.modified);
        
        return fileInfos;
    } catch (error) {
        logger.error({ err: error }, 'Failed to list download files');
        return [];
    }
}

/**
 * Delete file from download directory
 * 
 * @param {string} filename - Filename to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteFile(filename) {
    const filepath = path.join(DOWNLOAD_DIR, filename);
    
    try {
        await fs.unlink(filepath);
        logger.debug({ filename }, 'File deleted');
        return { success: true };
    } catch (error) {
        logger.error({ err: error, filename }, 'Failed to delete file');
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Cleanup old files
 * 
 * @param {number} maxAge - Maximum file age in ms
 * @returns {Promise<{deleted: number, errors: number}>}
 */
export async function cleanupOldFiles(maxAge = FILE_MAX_AGE) {
    await ensureDownloadDir();
    
    const now = Date.now();
    let deleted = 0;
    let errors = 0;
    
    try {
        const files = await fs.readdir(DOWNLOAD_DIR);
        
        for (const filename of files) {
            const filepath = path.join(DOWNLOAD_DIR, filename);
            
            try {
                const stats = await fs.stat(filepath);
                
                // Skip directories
                if (stats.isDirectory()) {
                    continue;
                }
                
                const fileAge = now - stats.mtime.getTime();
                
                if (fileAge > maxAge) {
                    await fs.unlink(filepath);
                    deleted++;
                    logger.debug({ filename, age: Math.round(fileAge / 1000 / 60) }, 'Deleted old file');
                }
            } catch (error) {
                errors++;
                logger.debug({ err: error, filename }, 'Failed to process file during cleanup');
            }
        }
        
        if (deleted > 0) {
            logger.info({ deleted, errors }, 'Cleanup completed');
        }
        
        return { deleted, errors };
    } catch (error) {
        logger.error({ err: error }, 'Failed to cleanup old files');
        return { deleted, errors };
    }
}

/**
 * Get file stream for serving
 * 
 * @param {string} filename - Filename
 * @returns {Promise<{stream: ReadableStream, size: number, contentType: string}>}
 */
export async function getFileStream(filename) {
    const filepath = path.join(DOWNLOAD_DIR, filename);
    
    try {
        const stats = await fs.stat(filepath);
        const stream = createReadStream(filepath);
        
        // Determine content type from extension
        const ext = path.extname(filename).toLowerCase();
        const contentTypeMap = {
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.webm': 'video/webm',
            '.mkv': 'video/x-matroska',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
        };
        
        const contentType = contentTypeMap[ext] || 'application/octet-stream';
        
        return {
            stream,
            size: stats.size,
            contentType,
        };
    } catch (error) {
        logger.error({ err: error, filename }, 'Failed to get file stream');
        throw error;
    }
}

// Start cleanup interval
let cleanupInterval = null;

export function startCleanupInterval() {
    if (cleanupInterval) {
        return; // Already started
    }
    
    cleanupInterval = setInterval(() => {
        cleanupOldFiles().catch(err => {
            logger.error({ err }, 'Cleanup interval error');
        });
    }, CLEANUP_INTERVAL);
    
    // Log is minimal - detailed startup info is shown in api.js
    // This prevents duplicate/cluttered startup logs
}

export function stopCleanupInterval() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Stopped download cleanup interval');
    }
}

// Initialize on module load
ensureDownloadDir().catch(err => {
    logger.error({ err }, 'Failed to initialize download directory');
});

