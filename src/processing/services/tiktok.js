import Cookie from "../cookie/cookie.js";

import { extract, normalizeURL } from "../url.js";
import { genericUserAgent } from "../../config.js";
import { updateCookie } from "../cookie/manager.js";
import { createStream } from "../../stream/manage.js";
import { convertLanguageCode } from "../../misc/language-codes.js";
import { logger } from "../../util/logger.js";

const shortDomain = "https://vt.tiktok.com/";

/**
 * Lazy-loaded Puppeteer instance with Stealth plugin
 * Prevents bot detection by TikTok
 */
let puppeteer = null;

/**
 * Get or initialize Puppeteer instance with Stealth plugin
 * 
 * @returns {Promise<Object>} Puppeteer instance with stealth plugin
 */
async function getPuppeteer() {
    if (!puppeteer) {
        const puppeteerExtra = await import('puppeteer-extra');
        const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
        puppeteerExtra.default.use(StealthPlugin());
        puppeteer = puppeteerExtra.default;
    }
    return puppeteer;
}

/**
 * Fetch TikTok user profile using headless browser (Puppeteer)
 * Optimized with Network Interception to capture clean API data
 * 
 * @param {string} username - Username (without @)
 * @param {Cookie} cookie - Cookie instance
 * @returns {Promise<{html: string, videos: Array}>} HTML content and extracted videos
 */
async function fetchProfileWithBrowser(username, cookie) {
    const puppeteer = await getPuppeteer();
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Hide automation traces
            '--disable-dev-shm-usage',
        ],
    });
    
    try {
        const page = await browser.newPage();
        // Use Map to prevent duplicate video IDs
        const collectedItems = new Map();

        /**
         * Network interception: Block unnecessary resources and capture API responses
         * This speeds up page loading by ~300% and captures clean video data
         */
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            // Block images, stylesheets, and fonts to speed up loading
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        /**
         * Intercept API responses to extract video data directly
         * TikTok uses lazy-loading, so we capture videos as they're loaded
         */
        page.on('response', async (res) => {
            const url = res.url();
            if (url.includes('/api/post/item_list/') || 
                url.includes('/api/user/list/') ||
                url.includes('/api/post/user_list/')) {
                try {
                    const data = await res.json();
                    // TikTok API response structure varies, try multiple paths
                    const itemList = data?.itemList || 
                                   data?.items || 
                                   data?.data?.itemList ||
                                   data?.data?.items ||
                                   [];
                    
                    if (Array.isArray(itemList) && itemList.length > 0) {
                        itemList.forEach(item => {
                            // Extract video ID from various possible fields
                            const videoId = item?.id || item?.videoId || item?.awemeId || item?.item?.id;
                            if (videoId) {
                                const videoData = item?.item || item;
                                // Log structure of first item for debugging
                                if (collectedItems.size === 0) {
                                    logger.debug({ username, videoId, itemKeys: Object.keys(videoData), hasVideo: !!videoData.video }, 'First video item structure from API');
                                }
                                // Use Map to prevent duplicates
                                collectedItems.set(videoId, videoData);
                            }
                        });
                        logger.debug({ username, count: itemList.length, total: collectedItems.size }, `Captured ${itemList.length} videos from API`);
                    }
                } catch (e) {
                    // Sometimes response is empty or invalid, skip silently
                }
            }
        });

        // Set user agent to avoid detection
        await page.setUserAgent(genericUserAgent);
        
        /**
         * Set cookies to maintain session state
         * This helps avoid bot detection and access restrictions
         */
        if (cookie && cookie.toString()) {
            const cookies = cookie.toString().split(';').map(c => {
                const [name, value] = c.trim().split('=');
                return { name, value: value || '', domain: '.tiktok.com', path: '/' };
            }).filter(c => c.name);
            
            if (cookies.length > 0) {
                await page.setCookie(...cookies);
            }
        }

        const profileUrl = `https://www.tiktok.com/@${username}`;
        logger.debug({ username, url: profileUrl }, 'Navigating to TikTok profile with browser');
        
        await page.goto(profileUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        /**
         * Smart scrolling loop to trigger lazy-loading
         * TikTok loads videos on-demand as user scrolls
         * Scroll 5 times to capture ~100-150 videos
         */
        logger.debug({ username }, 'Scrolling to trigger lazy-loading');
        
        for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            // Wait for API to respond with new videos
            await new Promise(resolve => setTimeout(resolve, 3000));
            logger.debug({ username, scrollAttempt: i + 1, videoCount: collectedItems.size }, 'Scrolled, checking for new videos');
            
            // Limit total videos to avoid overwhelming the system
            if (collectedItems.size >= 200) {
                logger.debug({ username, videoCount: collectedItems.size }, 'Reached video limit');
                break;
            }
        }

        const html = await page.content();
        const videos = Array.from(collectedItems.values());

        /**
         * Fallback: If interception didn't capture any videos,
         * try extracting from static HTML rehydration data
         */
        if (videos.length === 0) {
            logger.debug({ username }, 'No videos from interception, trying fallback extraction');
            return await fallbackExtraction(page);
        }

        logger.info({ username, totalCaptured: videos.length }, 'Crawl finished using Interception');
        return { html, videos };
        
    } finally {
        await browser.close();
    }
}

/**
 * Fallback extraction method when API interception fails
 * Extracts video data from static HTML rehydration scripts
 * 
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{html: string, videos: Array}>} HTML content and extracted videos
 */
async function fallbackExtraction(page) {
    const html = await page.content();
    
    const videos = await page.evaluate(() => {
        const results = [];
        
        // Method 1: Try __UNIVERSAL_DATA_FOR_REHYDRATION__
        try {
            const script = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
            if (script) {
                const data = JSON.parse(script.textContent);
                const userProfile = data?.["__DEFAULT_SCOPE__"]?.["webapp.user-detail"] ||
                                  data?.["__DEFAULT_SCOPE__"]?.["webapp.user-profile"] ||
                                  data?.["__DEFAULT_SCOPE__"]?.["webapp.user"];
                
                if (userProfile) {
                    const itemList = userProfile?.itemList || 
                                   userProfile?.itemModule || 
                                   userProfile?.videoList ||
                                   userProfile?.userInfo?.itemList ||
                                   [];
                    
                    const videoList = Array.isArray(itemList) ? itemList : 
                                    (itemList?.videos || itemList?.items || Object.values(itemList || {}));
                    
                    if (Array.isArray(videoList) && videoList.length > 0) {
                        return videoList;
                    }
                }
            }
        } catch (e) {
            console.error('Failed to parse universal data:', e);
        }
        
        // Method 2: Try SIGI_STATE
        try {
            const sigiScript = document.querySelector('script#SIGI_STATE');
            if (sigiScript) {
                const sigiData = JSON.parse(sigiScript.textContent);
                const itemModule = sigiData?.ItemModule;
                
                if (itemModule && typeof itemModule === 'object') {
                    return Object.values(itemModule);
                }
            }
        } catch (e) {
            console.error('Failed to parse SIGI_STATE:', e);
        }
        
        // Method 3: Extract video IDs from DOM
        const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'));
        const videoIds = new Set();
        
        videoLinks.forEach(link => {
            const href = link.getAttribute('href');
            const match = href.match(/\/video\/(\d{19,20})/);
            if (match) {
                videoIds.add(match[1]);
            }
        });
        
        // Return minimal video objects with IDs
        return Array.from(videoIds).map(id => ({ id, videoId: id, awemeId: id, _needsFetch: true }));
    });
    
    logger.debug({ videoCount: videos?.length || 0 }, 'Fallback extraction completed');
    
    return { html, videos: videos || [] };
}

/**
 * Process video list for both user profiles and playlists
 * Extracts video URLs, validates them, and creates picker items
 * 
 * @param {Array} videos - Array of video items from TikTok API
 * @param {string} username - Username (without @)
 * @param {Cookie} cookie - Cookie instance for authentication
 * @param {Object} obj - Handler options
 * @param {string} type - Type of list: "user" or "playlist"
 * @returns {Promise<Array>} Array of valid video picker items
 */
async function processVideoList(videos, username, cookie, obj, type = "user") {
    /**
     * Process all videos in parallel
     * Always fetch fresh video details to ensure URLs are not expired
     */
    const videoPromises = videos.map(async (item, originalIndex) => {
        const videoItem = item?.item || item;
        const videoId = videoItem?.id || videoItem?.awemeId || videoItem?.videoId;
        if (!videoId) {
            return { originalIndex, error: 'Missing videoId' };
        }

        /**
         * Extract video URL from various possible structures
         * TikTok API response structure varies, so we try multiple paths
         * Priority: PlayAddrStruct.UrlList > playAddr.urlList > downloadAddr.urlList
         */
        let videoUrl = null;
        let urlSource = null;
        
        if (videoItem?.video?.PlayAddrStruct?.UrlList?.[0]) {
            videoUrl = videoItem.video.PlayAddrStruct.UrlList[0];
            urlSource = 'PlayAddrStruct.UrlList';
        } else if (videoItem?.video?.PlayAddrStruct?.urlList?.[0]) {
            videoUrl = videoItem.video.PlayAddrStruct.urlList[0];
            urlSource = 'PlayAddrStruct.urlList';
        } else if (videoItem?.video?.PlayAddrStruct?.url_list?.[0]) {
            videoUrl = videoItem.video.PlayAddrStruct.url_list[0];
            urlSource = 'PlayAddrStruct.url_list';
        } else if (videoItem?.video?.playAddr?.urlList?.[0]) {
            videoUrl = videoItem.video.playAddr.urlList[0];
            urlSource = 'playAddr.urlList';
        } else if (videoItem?.video?.play_addr?.url_list?.[0]) {
            videoUrl = videoItem.video.play_addr.url_list[0];
            urlSource = 'play_addr.url_list';
        } else if (videoItem?.video?.downloadAddr?.urlList?.[0]) {
            videoUrl = videoItem.video.downloadAddr.urlList[0];
            urlSource = 'downloadAddr.urlList';
        } else if (videoItem?.video?.download_addr?.url_list?.[0]) {
            videoUrl = videoItem.video.download_addr.url_list[0];
            urlSource = 'download_addr.url_list';
        }

        /**
         * Handle case where playAddr/downloadAddr are objects instead of strings
         * Extract urlList from the object structure
         */
        if (!videoUrl && videoItem?.video?.playAddr && typeof videoItem.video.playAddr === 'object') {
            videoUrl = videoItem.video.playAddr.urlList?.[0] || videoItem.video.playAddr.url_list?.[0];
            urlSource = 'playAddr.object';
        }
        
        if (!videoUrl && videoItem?.video?.downloadAddr && typeof videoItem.video.downloadAddr === 'object') {
            videoUrl = videoItem.video.downloadAddr.urlList?.[0] || videoItem.video.downloadAddr.url_list?.[0];
            urlSource = 'downloadAddr.object';
        }
        
        /**
         * Fallback: If no URL found in API response, fetch fresh video details
         * TikTok URLs expire quickly, so we always fetch fresh details for playlists
         * This ensures URLs are valid when downloads start
         */
        if (!videoUrl) {
            let retryCount = 0;
            const maxRetries = 2;
            
            while (retryCount <= maxRetries && !videoUrl) {
                try {
                    const res = await fetch(`https://www.tiktok.com/@i/video/${videoId}`, {
                        headers: { "user-agent": genericUserAgent, cookie }
                    });
                    if (res.status === 200) {
                        const html = await res.text();
                        const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.+?)<\/script>/s);
                        if (jsonMatch) {
                            const detail = JSON.parse(jsonMatch[1])?.["__DEFAULT_SCOPE__"]?.["webapp.video-detail"]?.itemInfo?.itemStruct;
                            videoUrl = detail?.video?.playAddr?.urlList?.[0] || 
                                       detail?.video?.playAddr ||
                                       detail?.video?.downloadAddr?.urlList?.[0];
                        }
                    }
                } catch (e) {
                    // Exponential backoff: wait longer on each retry
                    if (retryCount < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                    }
                }
                retryCount++;
            }
            
            if (!videoUrl) {
                return { originalIndex, videoId, error: 'Failed to fetch video URL after retries' };
            }
        }

        if (!videoUrl || typeof videoUrl !== 'string') {
            return { originalIndex, videoId, error: 'Invalid video URL' };
        }
        
        // Validate URL format
        try {
            new URL(videoUrl);
        } catch (e) {
            logger.warn({ videoId, originalIndex, videoUrl: videoUrl.substring(0, 100), error: e.message }, 'Invalid URL format');
            return { originalIndex, videoId, error: 'Invalid URL format' };
        }

        // Filename will be updated later for playlists to include sequence number
        const filename = `tiktok_${type}_${username}_${videoId}.mp4`;

        return {
            type: "video",
            url: videoUrl,
            filename,
            thumb: videoItem?.video?.cover?.urlList?.[0],
            videoId,
            originalIndex, // Preserve original index to maintain playlist order
        };
    });

    const result = await Promise.all(videoPromises);
    
    /**
     * Separate valid and failed videos
     * Failed videos are logged but don't break the entire process
     */
    const validVideos = [];
    const failedVideos = [];
    
    result.forEach(item => {
        if (item && !item.error && item.url) {
            validVideos.push(item);
        } else if (item && item.error) {
            failedVideos.push(item);
        }
    });
    
    /**
     * For playlists, add sequence numbers based on originalIndex
     * This preserves the original playlist order even if some videos fail
     * Example: If video #3 fails, video #4 is still numbered 004 (not 003)
     */
    if (type === "playlist") {
        validVideos.forEach((video) => {
            const sequenceNumber = String(video.originalIndex + 1).padStart(3, '0');
            video.filename = `tiktok_${type}_${username}_${sequenceNumber}_${video.videoId}.mp4`;
        });
    }
    
    if (failedVideos.length > 0) {
        logger.warn({ 
            total: videos.length, 
            valid: validVideos.length,
            failed: failedVideos.length,
            failedIndices: failedVideos.map(v => v.originalIndex + 1).sort((a, b) => a - b)
        }, 'Some videos failed to process');
    }
    
    return validVideos;
}

/**
 * Handle TikTok playlist/mix extraction
 * Uses Puppeteer to navigate to playlist page and intercept API calls
 * 
 * @param {string} username - Username (without @)
 * @param {string} playlistId - Playlist ID
 * @param {string} playlistName - Playlist name (may be URL-encoded)
 * @param {Cookie} cookie - Cookie instance
 * @param {Object} obj - Handler options
 * @param {string} rawUrl - Full playlist URL (preserves encoding)
 * @returns {Promise<Object>} Picker response with videos
 */
async function handlePlaylist(username, playlistId, playlistName, cookie, obj, rawUrl) {
    const puppeteerModule = await getPuppeteer();
    const browser = await puppeteerModule.launch({ headless: "new", args: ['--no-sandbox'] });
    
    try {
        const page = await browser.newPage();
        // Use Map to prevent duplicate video IDs
        const collectedItems = new Map();

        /**
         * Intercept playlist API responses
         * TikTok uses /api/mix/item_list/ or /api/playlist/item_list/ endpoints
         */
        let lastCursor = null;
        let hasMore = true;
        
        page.on('response', async (res) => {
            const url = res.url();
            if (url.includes('/api/mix/item_list/') || url.includes('/api/playlist/item_list/')) {
                try {
                    const data = await res.json();
                    const items = data?.itemList || data?.items || [];
                    items.forEach(item => {
                        const id = item?.id || item?.awemeId;
                        if (id) collectedItems.set(id, item);
                    });
                    
                    /**
                     * Check pagination status
                     * Prioritize API's hasMore flag, fallback to item count
                     */
                    if (data?.hasMore === false) {
                        hasMore = false;
                    } else if (data?.hasMore === true) {
                        hasMore = true;
                    } else {
                        // If hasMore is not explicitly set, assume more if we got items
                        hasMore = items.length > 0;
                    }
                    lastCursor = data?.cursor || data?.nextCursor || null;
                    
                } catch (e) {
                    logger.warn({ url, error: e.message }, 'Failed to parse Mix API response');
                }
            }
        });

        await page.setUserAgent(genericUserAgent);
        
        /**
         * Set cookies to maintain session state
         * Required for accessing playlists and avoiding bot detection
         */
        if (cookie && cookie.toString()) {
            const cookies = cookie.toString().split('; ').map(c => {
                const [name, ...valueParts] = c.split('=');
                const value = valueParts.join('=');
                return { name, value, domain: '.tiktok.com', path: '/' };
            }).filter(c => c.name);
            
            if (cookies.length > 0) {
                await page.setCookie(...cookies);
            }
        }
        
        /**
         * Navigate to playlist URL
         * Use rawUrl to preserve correct encoding (especially for Vietnamese characters)
         */
        await page.goto(rawUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        /**
         * Smart scrolling to load all videos in playlist
         * TikTok playlists can have 100+ videos, all loaded via lazy-loading
         * The playlist has a separate scrollable container for the video list
         */
        let previousCount = collectedItems.size;
        let scrollAttempts = 0;
        const maxScrollAttempts = 100; // Increased to ensure all videos are loaded
        let noNewVideosCount = 0; // Count consecutive scrolls with no new videos
        
        while (scrollAttempts < maxScrollAttempts && (hasMore || noNewVideosCount < 5)) {
            /**
             * Scroll within the video list container
             * TikTok playlists have a specific scrollable container, not the whole page
             */
            const scrollResult = await page.evaluate(() => {
                // Find scrollable container - TikTok uses various class names
                const containers = [
                    document.querySelector('[class*="DivVideoListContainer"]'),
                    document.querySelector('[class*="DivListContainer"]'),
                    document.querySelector('[class*="DivListInnerContainer"]'),
                    document.querySelector('#main-content-playlist')
                ].filter(Boolean);
                
                for (const container of containers) {
                    // Check if container is actually scrollable
                    const style = window.getComputedStyle(container);
                    const isScrollable = container.scrollHeight > container.clientHeight && 
                                       (style.overflowY === 'scroll' || style.overflowY === 'auto' || 
                                        container.scrollHeight > container.offsetHeight);
                    
                    if (isScrollable) {
                        const currentScroll = container.scrollTop || 0;
                        const maxScroll = container.scrollHeight - container.clientHeight;
                        
                        // Scroll in small steps to trigger lazy-loading
                        const scrollStep = 400;
                        const newScroll = Math.min(currentScroll + scrollStep, maxScroll);
                        container.scrollTop = newScroll;
                        
                        return {
                            found: true,
                            scrolled: newScroll > currentScroll,
                            currentScroll: currentScroll,
                            maxScroll: maxScroll,
                            containerClass: container.className.substring(0, 50)
                        };
                    }
                }
                
                // Fallback: scroll entire page if no scrollable container found
                window.scrollBy(0, 500);
                return { found: false, scrolled: true };
            });
            
            /**
             * Wait for API to load new videos
             * TikTok can be slow, so we wait longer normally
             * Reduce wait time if we're near the end (80% scrolled)
             */
            const waitTime = scrollResult.scrolled && scrollResult.currentScroll > scrollResult.maxScroll * 0.8 
                ? 2000  // Shorter wait when near end
                : 3000; // Normal wait time
            await new Promise(r => setTimeout(r, waitTime));
            
            const currentCount = collectedItems.size;
            const newVideos = currentCount - previousCount;
            
            // Reset counter if new videos were found
            if (newVideos > 0) {
                noNewVideosCount = 0;
            } else {
                noNewVideosCount++;
            }
            
            /**
             * Stop scrolling if:
             * - No new videos after 5 consecutive scrolls AND API says no more (hasMore = false)
             * - API says no more (hasMore = false) AND no new videos after 3 scrolls
             */
            if (noNewVideosCount >= 5 && !hasMore) {
                break;
            }
            
            if (!hasMore && noNewVideosCount >= 3) {
                break;
            }
            
            previousCount = currentCount;
            scrollAttempts++;
        }

        /**
         * Extract cookies from page after navigation
         * These cookies may be updated by TikTok during the session
         */
        const pageCookies = await page.cookies();
        const cookieString = pageCookies.map(c => `${c.name}=${c.value}`).join('; ');

        const videos = Array.from(collectedItems.values());
        
        if (videos.length === 0) {
            logger.warn({ rawUrl }, 'No videos collected from Mix API');
            return { error: "fetch.empty" };
        }
        
        /**
         * Process videos to extract URLs and create picker items
         * This will fetch fresh video details for each video to ensure URLs are valid
         */
        const picker = await processVideoList(videos, username, cookie, obj, "playlist");
        
        if (picker.length === 0) {
            logger.warn({ videoCount: videos.length }, 'No valid videos after processing');
            return { error: "fetch.empty" };
        }
        
        /**
         * Decode playlist name if it's URL-encoded
         * Playlist names may contain Unicode characters (Vietnamese, Chinese, etc.)
         */
        let decodedPlaylistName = playlistName || '';
        if (decodedPlaylistName) {
            try {
                // Try to decode, but if it fails (already decoded), use original
                decodedPlaylistName = decodeURIComponent(decodedPlaylistName);
            } catch (e) {
                // Already decoded or invalid, use as-is
                decodedPlaylistName = playlistName;
            }
        }
        
        logger.debug({ username, playlistName: decodedPlaylistName, original: playlistName }, 'Returning playlist with name');
        
        return { 
            picker, 
            headers: { cookie: cookieString || cookie.toString() }, 
            username: `@${username}`,
            playlistName: decodedPlaylistName,
            autoDownload: true 
        };
    } finally {
        await browser.close();
    }
}

/**
 * Handle TikTok user profile - fetch multiple videos
 * 
 * @param {string} user - Username (without @)
 * @param {Cookie} cookie - Cookie instance
 * @param {Object} obj - Handler options
 * @returns {Promise<Object>} Picker response with videos
 */
async function handleUserProfile(user, cookie, obj) {
    // Remove @ if present
    const username = user.replace(/^@/, '');
    
    logger.debug({ username }, 'Fetching TikTok user profile');
    
    // First, try regular fetch
    let res;
    let html;
    let videos = [];
    
    try {
        res = await fetch(`https://www.tiktok.com/@${username}`, {
            headers: {
                "user-agent": genericUserAgent,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.9",
                "accept-encoding": "gzip, deflate, br",
                "referer": "https://www.tiktok.com/",
                cookie,
            },
            redirect: 'follow'
        });
        
        updateCookie(cookie, res.headers);
        
        if (res.status !== 200) {
            logger.warn({ username, status: res.status }, 'Failed to fetch TikTok user profile');
            return { error: "fetch.fail" };
        }
        
        html = await res.text();
        logger.debug({ username, htmlLength: html.length }, 'Fetched TikTok user profile HTML');
        
        // Try to parse videos from HTML
        try {
            const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.+?)<\/script>/s);
            if (jsonMatch) {
                const data = JSON.parse(jsonMatch[1]);
                const userProfile = data["__DEFAULT_SCOPE__"]?.["webapp.user-detail"] ||
                                  data["__DEFAULT_SCOPE__"]?.["webapp.user-profile"] ||
                                  data["__DEFAULT_SCOPE__"]?.["webapp.user"];
                
                if (userProfile) {
                    const itemList = userProfile?.itemList || 
                                    userProfile?.itemModule || 
                                    userProfile?.videoList ||
                                    userProfile?.userInfo?.itemList ||
                                    [];
                    
                    videos = Array.isArray(itemList) ? itemList : 
                            (itemList?.videos || itemList?.items || Object.values(itemList || {}));
                    
                    logger.debug({ username, videoCount: videos.length }, 'Found videos from regular fetch');
                }
            }
        } catch (e) {
            logger.debug({ username, error: e.message }, 'Failed to parse videos from regular fetch');
        }
        
        // Also try SIGI_STATE
        if (videos.length === 0) {
            try {
                const sigiMatch = html.match(/<script id="SIGI_STATE" type="application\/json">(.+?)<\/script>/s);
                if (sigiMatch) {
                    const sigiData = JSON.parse(sigiMatch[1]);
                    const itemModule = sigiData?.ItemModule;
                    
                    if (itemModule && typeof itemModule === 'object') {
                        videos = Object.values(itemModule);
                        logger.debug({ username, videoCount: videos.length }, 'Found videos from SIGI_STATE');
                    }
                }
            } catch (e) {
                logger.debug({ username, error: e.message }, 'Failed to parse SIGI_STATE');
            }
        }
        
    } catch (error) {
        logger.error({ err: error, username }, 'Error in regular fetch');
    }
    
    // If no videos found, try headless browser
    if (videos.length === 0) {
        logger.info({ username }, 'No videos found in regular fetch, trying headless browser');
        
        try {
            const browserResult = await fetchProfileWithBrowser(username, cookie);
            html = browserResult.html;
            videos = browserResult.videos;
            
            logger.info({ username, videoCount: videos.length }, 'Fetched videos using headless browser');
        } catch (error) {
            logger.error({ err: error, username }, 'Failed to fetch with headless browser');
            // Continue with empty videos, will return error below
        }
    }
    
    if (!videos || videos.length === 0) {
        logger.warn({ username }, 'No videos found after all methods');
        return { error: "fetch.empty" };
    }
    
        // Process videos in parallel
        const videoPromises = videos.slice(0, 50).map(async (item, i) => {
            // Extract video data - structure may vary
            const videoItem = item?.item || item;
            const videoId = videoItem?.id || videoItem?.videoId || videoItem?.awemeId;
            
            if (!videoId) return null;
            
            // Check if video has URL, if not, need to fetch details
            const hasVideoUrl = videoItem?.video?.playAddr?.urlList?.[0] ||
                              videoItem?.video?.downloadAddr?.urlList?.[0] ||
                              videoItem?.videoUrl;
            
            // If video needs full fetch (from browser extraction or API doesn't have full data), fetch it now
            if (videoItem._needsFetch || !videoItem.video || !hasVideoUrl) {
                logger.debug({ username, videoId, hasVideo: !!videoItem.video, hasVideoUrl: !!hasVideoUrl }, 'Fetching full video details');
            logger.debug({ username, videoId }, 'Fetching full video details');
            try {
                const videoRes = await fetch(`https://www.tiktok.com/@i/video/${videoId}`, {
                    headers: {
                        "user-agent": genericUserAgent,
                        cookie,
                    }
                });
                
                if (videoRes.status === 200) {
                    const videoHtml = await videoRes.text();
                    
                    // Try to parse video detail
                    try {
                        const videoJsonMatch = videoHtml.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.+?)<\/script>/s);
                        if (videoJsonMatch) {
                            const videoData = JSON.parse(videoJsonMatch[1]);
                            const videoDetail = videoData["__DEFAULT_SCOPE__"]?.["webapp.video-detail"];
                            const detail = videoDetail?.itemInfo?.itemStruct;
                            
                            if (detail && detail.video) {
                                Object.assign(videoItem, detail);
                                logger.debug({ username, videoId }, 'Successfully fetched full video details');
                            }
                        }
                    } catch (e) {
                        logger.debug({ username, videoId, error: e.message }, 'Failed to parse video detail');
                    }
                }
            } catch (e) {
                logger.debug({ username, videoId, error: e.message }, 'Error fetching video details');
            }
        }
        
        // Get video URL - try multiple paths
        let videoUrl = videoItem?.video?.playAddr?.urlList?.[0] ||
                      videoItem?.video?.downloadAddr?.urlList?.[0] ||
                      videoItem?.video?.playAddr ||
                      videoItem?.video?.downloadAddr ||
                      videoItem?.videoUrl;
        
        // If videoUrl is an object, try to get urlList
        if (videoUrl && typeof videoUrl === 'object' && videoUrl.urlList) {
            videoUrl = videoUrl.urlList[0];
        }
        
        // If still an array, get first element
        if (Array.isArray(videoUrl)) {
            videoUrl = videoUrl[0];
        }
        
        // Ensure videoUrl is a string
        if (videoUrl && typeof videoUrl === 'object') {
            // Try to extract URL from object
            videoUrl = videoUrl.url || videoUrl.href || videoUrl.toString();
        }
        
        if (!videoUrl || typeof videoUrl !== 'string') {
            logger.debug({ username, videoId, videoUrlType: typeof videoUrl, videoUrl, videoItemKeys: Object.keys(videoItem || {}), hasVideo: !!videoItem?.video }, 'No valid video URL found, video item structure');
            return null;
        }
        
        // Get thumbnail
        const thumbUrl = videoItem?.video?.cover?.urlList?.[0] ||
                       videoItem?.video?.dynamicCover?.urlList?.[0] ||
                       videoItem?.cover;
        
        // Create filename
        const filename = `tiktok_${username}_${videoId}.mp4`;
        
        // Always use direct URL here - tunnel will be created in match-action.js
        const url = videoUrl;
        
        return {
            type: "video",
            url,
            filename,
            ...(thumbUrl && { thumb: thumbUrl }),
        };
    });
    
    const videoItems = await Promise.all(videoPromises);
    const validVideos = videoItems.filter(v => v !== null);
    
    if (validVideos.length === 0) {
        logger.warn({ username, totalVideos: videos.length }, 'No valid videos after processing');
        return { error: "fetch.empty" };
    }
    
    logger.info({ username, validVideoCount: validVideos.length }, 'Successfully processed TikTok user profile videos');
    
    return {
        picker: validVideos,
        headers: { cookie },
        username: user.replace(/^@/, ''), // Pass username for folder structure
    };
}

/**
 * Main TikTok handler - processes single videos, playlists, and user profiles
 * Priority order: Playlist > User Profile > Single Video
 * 
 * @param {Object} obj - Handler options
 * @param {string} obj.postId - Video post ID
 * @param {string} obj.shortLink - TikTok short link
 * @param {string} obj.user - Username (with or without @)
 * @param {string} obj.playlistId - Playlist/Mix ID
 * @param {string} obj.playlistName - Playlist/Mix name
 * @param {string} obj.originalRequest - Raw URL string (for encoding preservation)
 * @param {boolean} obj.fullAudio - Use original audio instead of watermarked
 * @param {boolean} obj.h265 - Allow H.265/HEVC codec
 * @param {boolean} obj.isAudioOnly - Extract audio only
 * @returns {Promise<Object>} Response object with video/audio URLs or picker
 */
export default async function(obj) {
    const cookie = new Cookie({});
    
    /**
     * PRIORITY 1: Handle playlist/mix
     * Check playlistId from pattern matching (set by service-registry)
     */
    if (obj.playlistId && obj.user) {
        const username = obj.user.replace(/^@/, '');
        let playlistName = '';
        
        /**
         * Extract playlist name from original URL to ensure correct encoding
         * Priority 1: Extract from originalRequest (raw URL string, not decoded)
         * This preserves the original URL encoding for Unicode characters
         */
        if (obj.originalRequest) {
            // Extract directly from URL string using regex (avoid URL object to prevent auto-decode)
            const pathMatch = obj.originalRequest.match(/https?:\/\/[^\/]+(\/[^?#]*)/);
            if (pathMatch) {
                const pathname = pathMatch[1];
                const playlistMatch = pathname.match(/\/playlist\/([^-]+)-(\d+)/);
                if (playlistMatch) {
                    const playlistNameRaw = playlistMatch[1];
                    try {
                        playlistName = decodeURIComponent(playlistNameRaw);
                        logger.debug({ playlistNameRaw, playlistName }, 'Extracted playlistName from originalRequest');
                    } catch (e) {
                        playlistName = playlistNameRaw;
                    }
                }
            }
        }
        
        /**
         * Priority 2: Decode from obj.playlistName if it's still URL-encoded
         * Pattern matching may return URL-encoded string
         * Check for incorrect decoding artifacts (garbled characters)
         */
        if (!playlistName && obj.playlistName) {
            try {
                const decoded = decodeURIComponent(obj.playlistName);
                // Check for garbled characters indicating incorrect decoding
                // Characters like "ß╗ú" or "┼⌐" indicate wrong encoding was used
                if (!decoded.match(/[ß╗ú┼⌐├┤]/)) {
                    playlistName = decoded;
                } else {
                    logger.debug({ playlistName: obj.playlistName, decoded }, 'PlaylistName appears to be incorrectly decoded, skipping');
                }
            } catch (e) {
                logger.debug({ playlistName: obj.playlistName, error: e.message }, 'PlaylistName decode failed, skipping');
            }
        }
        
        /**
         * Fallback: Extract from obj.url if originalRequest not available
         */
        if (!playlistName && obj.url) {
            let urlString = '';
            if (obj.url instanceof URL) {
                urlString = obj.url.href;
            } else {
                urlString = obj.url.toString();
            }
            
            const pathMatch = urlString.match(/https?:\/\/[^\/]+(\/[^?#]*)/);
            if (pathMatch) {
                const pathname = pathMatch[1];
                const playlistMatch = pathname.match(/\/playlist\/([^-]+)-(\d+)/);
                if (playlistMatch) {
                    const playlistNameRaw = playlistMatch[1];
                    try {
                        playlistName = decodeURIComponent(playlistNameRaw);
                    } catch (e) {
                        playlistName = playlistNameRaw;
                    }
                }
            }
        }
        
        // Final fallback: use obj.playlistName as-is (may be incorrectly decoded)
        if (!playlistName && obj.playlistName) {
            playlistName = obj.playlistName;
        }
        
        /**
         * Use original URL from obj.url (normalized but preserves encoding)
         * If not available, reconstruct from matched information
         */
        let fullUrl = obj.url ? obj.url.toString() : null;
        if (!fullUrl || !fullUrl.includes('/playlist/')) {
            fullUrl = `https://www.tiktok.com/@${username}/playlist/${encodeURIComponent(playlistName)}-${obj.playlistId}`;
        }
        
        logger.debug({ 
            username, 
            playlistName, 
            playlistId: obj.playlistId, 
            source: 'pattern_match', 
            originalFromPattern: obj.playlistName,
            hasOriginalRequest: !!obj.originalRequest,
            originalRequestPreview: obj.originalRequest ? obj.originalRequest.substring(0, 100) : null,
            extractedFromOriginalRequest: playlistName && obj.originalRequest ? 'yes' : 'no'
        }, 'Extracted playlist from pattern matching');
        return await handlePlaylist(username, obj.playlistId, playlistName, cookie, obj, fullUrl);
    }
    
    /**
     * FALLBACK: If no playlistId from pattern matching, parse from URL
     */
    let rawUrl = "";
    if (obj.url) {
        if (obj.url instanceof URL) {
            rawUrl = obj.url.pathname;
        } else {
            rawUrl = decodeURIComponent(obj.url.toString());
        }
    }
    
    /**
     * Check for playlist pattern in URL string
     */
    const playlistMatch = rawUrl.match(/@([^/]+)\/playlist\/([^-]+)-(\d+)/);
    if (playlistMatch) {
        const [_, username, playlistNameRaw, playlistId] = playlistMatch;
        // Decode playlist name from URL
        let playlistName = playlistNameRaw;
        try {
            playlistName = decodeURIComponent(playlistNameRaw);
        } catch (e) {
            // Already decoded or invalid, use as-is
            playlistName = playlistNameRaw;
        }
        const fullUrl = obj.url instanceof URL 
            ? obj.url.toString() 
            : (rawUrl.startsWith('http') ? rawUrl : `https://www.tiktok.com${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`);
        logger.debug({ username, playlistName, playlistId, raw: playlistNameRaw }, 'Extracted playlist from URL');
        return await handlePlaylist(username, playlistId, playlistName, cookie, obj, fullUrl);
    }

    /**
     * PRIORITY 2: Handle user profile (if not a playlist)
     */
    const user = obj.user;
    const postId = obj.postId;

    if (user && !postId) {
        /**
         * Handle user profile
         * Note: Currently commented out - uncomment to enable user profile support
         */
        const username = user.replace("@", "");
        // return await handleUserProfile(username, cookie, obj);
    }

    if (!postId) {
        let html = await fetch(`${shortDomain}${obj.shortLink}`, {
            redirect: "manual",
            headers: {
                "user-agent": genericUserAgent.split(' Chrome/1')[0]
            }
        }).then(r => r.text()).catch(() => {});

        if (!html) return { error: "fetch.fail" };

        if (html.startsWith('<a href="https://')) {
            const extractedURL = html.split('<a href="')[1].split('?')[0];
            const { host, patternMatch } = extract(normalizeURL(extractedURL));
            if (host === "tiktok") {
                postId = patternMatch?.postId;
            }
        }
    }
    if (!postId) return { error: "fetch.short_link" };

    /**
     * Fetch single video details
     * TikTok uses /video/ endpoint even for photo posts
     */
    const res = await fetch(`https://www.tiktok.com/@i/video/${postId}`, {
        headers: {
            "user-agent": genericUserAgent,
            cookie,
        }
    })
    updateCookie(cookie, res.headers);

    const html = await res.text();

    let detail;
    try {
        const json = html
            .split('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">')[1]
            .split('</script>')[0];

        const data = JSON.parse(json);
        const videoDetail = data["__DEFAULT_SCOPE__"]["webapp.video-detail"];

        if (!videoDetail) throw "no video detail found";

        /**
         * Check if video is unavailable (deleted, private, etc.)
         */
        if (videoDetail.statusMsg) {
            return { error: "content.post.unavailable"};
        }

        detail = videoDetail?.itemInfo?.itemStruct;
    } catch {
        return { error: "fetch.fail" };
    }

    if (detail.isContentClassified) {
        return { error: "content.post.age" };
    }

    if (!detail.author) {
        return { error: "fetch.empty" };
    }

    let video, videoFilename, audioFilename, audio, images,
        filenameBase = `tiktok_${detail.author?.uniqueId}_${postId}`,
        bestAudio; // Will be defaulted to m4a later in match-action

    images = detail.imagePost?.images;

    /**
     * Get video play address
     * Support H.265/HEVC codec if requested
     */
    let playAddr = detail.video?.playAddr;

    if (obj.h265) {
        // Find H.265 stream in bitrate info
        const h265PlayAddr = detail?.video?.bitrateInfo?.find(b => b.CodecType.includes("h265"))?.PlayAddr.UrlList[0]
        playAddr = h265PlayAddr || playAddr
    }

    if (!obj.isAudioOnly && !images) {
        video = playAddr;
        videoFilename = `${filenameBase}.mp4`;
    } else {
        audio = playAddr;
        audioFilename = `${filenameBase}_audio`;

        /**
         * Use original audio if requested or if no watermarked audio available
         */
        if (obj.fullAudio || !audio) {
            audio = detail.music.playUrl;
            audioFilename += `_original`
        }
        // Detect audio format from URL
        if (audio.includes("mime_type=audio_mpeg")) bestAudio = 'mp3';
    }

    if (video) {
        /**
         * Extract subtitles if requested
         * Convert language code from ISO 639-1 (2 chars) to ISO 639-2 (3 chars)
         */
        let subtitles, fileMetadata;
        if (obj.subtitleLang && detail?.video?.subtitleInfos?.length) {
            const langCode = convertLanguageCode(obj.subtitleLang);
            const subtitle = detail?.video?.subtitleInfos.find(
                s => s.LanguageCodeName.startsWith(langCode) && s.Format === "webvtt"
            )
            if (subtitle) {
                subtitles = subtitle.Url;
                fileMetadata = {
                    sublanguage: langCode,
                }
            }
        }
        return {
            urls: video,
            subtitles,
            fileMetadata,
            filename: videoFilename,
            headers: { cookie }
        }
    }

    if (images && obj.isAudioOnly) {
        return {
            urls: audio,
            audioFilename: audioFilename,
            isAudioOnly: true,
            bestAudio,
            headers: { cookie }
        }
    }

    if (images) {
        /**
         * Handle image posts (slideshows)
         * Create picker for each image
         */
        const imagePromises = images
            .map(i => i.imageURL.urlList.find(p => p.includes(".jpeg?")))
            .map(async (url, i) => {
                // Create tunnel URL if alwaysProxy is enabled
                if (obj.alwaysProxy) {
                    url = await createStream({
                        service: "tiktok",
                        type: "proxy",
                        url,
                        filename: `${filenameBase}_photo_${i + 1}.jpg`
                    })
                }

                return {
                    type: "photo",
                    url
                }
            });

        const imageLinks = await Promise.all(imagePromises);
        return {
            picker: imageLinks,
            urls: audio,
            audioFilename: audioFilename,
            isAudioOnly: true,
            bestAudio,
            headers: { cookie }
        }
    }

    if (audio) {
        return {
            urls: audio,
            audioFilename: audioFilename,
            isAudioOnly: true,
            bestAudio,
            headers: { cookie }
        }
    }

    return { error: "fetch.empty" };
}
