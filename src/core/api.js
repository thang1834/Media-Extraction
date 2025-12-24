import cors from "cors";
import express from "express";
import http from "node:http";
import path from "path";
import rateLimit from "express-rate-limit";
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger.js";

import stream from "../stream/stream.js";
import match from "../processing/match.js";

import { env } from "../config.js";
import { extract } from "../processing/url.js";
import { hashHmac } from "../security/secrets.js";
import { createStore } from "../store/redis-ratelimit.js";
import { randomizeCiphers } from "../misc/randomize-ciphers.js";
import { friendlyServiceName } from "../processing/service-alias.js";
import { verifyStream } from "../stream/manage.js";
import { createResponse, normalizeRequest, getIP } from "../processing/request.js";
import { setupTunnelHandler } from "./itunnel.js";
import { logger, logError, logRequest, logResponse, createChildLogger } from "../util/logger.js";
import { getHealthStatus } from "../util/health.js";
import { requestTimeout } from "../util/timeout.js";
import { LIMITS, NETWORK, CACHE_TTL } from "../util/constants.js";
import { nanoid } from "nanoid";
import { 
    downloadFile, 
    downloadFiles, 
    listFiles, 
    getFileInfo, 
    deleteFile, 
    getFileStream,
    startCleanupInterval 
} from "../util/download-manager.js";

import * as Cookies from "../processing/cookie/manager.js";
import * as YouTubeSession from "../processing/helpers/youtube-session.js";

/**
 * API Core Module
 * 
 * This module sets up the Express application with all middleware and routes.
 * It handles:
 * - CORS configuration
 * - Rate limiting
 * - Request validation
 * - Media extraction endpoint
 * - Tunnel streaming endpoint
 * - Swagger documentation
 */

// Regex to validate Accept and Content-Type headers
// Accepts: application/json, application/json; charset=utf-8, or */*
const acceptRegex = /^(application\/json(; charset=utf-8)?|\*\/\*)$/;

// CORS configuration - simplified for personal use

/**
 * Helper function to send error responses
 * 
 * @param {Object} res - Express response object
 * @param {string} code - Error code
 * @param {Object} context - Optional error context
 * @param {string} requestId - Request ID for logging
 */
const fail = async (res, code, context, requestId = null) => {
    // Add request ID to context for traceability
    const errorContext = {
        ...context,
        ...(requestId && { requestId }),
    };
    
    const { status, body } = await createResponse("error", { code, context: errorContext });
    
    // Log error for monitoring
    if (requestId) {
        logger.warn({
            requestId,
            errorCode: code,
            context: errorContext,
        }, 'Request failed');
    }
    
    // Only send response if headers not already sent (e.g., timeout already sent response)
    if (!res.headersSent) {
        res.status(status).json(body);
    } else {
        logger.debug({
            requestId,
            errorCode: code,
        }, 'Response already sent, skipping error response');
    }
}

/**
 * Main API setup function
 * 
 * Sets up all Express middleware, routes, and starts the HTTP server.
 * 
 * @param {Object} app - Express application instance
 * @param {string} __dirname - Project root directory
 */
export const runAPI = async (app, __dirname) => {
    // Record server start time for info endpoint
    const startTimestamp = Date.now();

    /**
     * Generate server information JSON
     * Used for GET / endpoint
     * 
     * @returns {string} JSON string with server info
     */
    const getServerInfo = () => {
        return JSON.stringify({
            api: {
                url: env.apiURL,
                startTime: `${startTimestamp}`,
                services: [...env.enabledServices].map(e => {
                    return friendlyServiceName(e);
                }),
            },
        });
    }

    // Cache server info (unless env file watching is enabled)
    const serverInfo = getServerInfo();

    /**
     * Rate limit exceeded handler
     * Returns 429 status with rate limit error
     */
    const handleRateExceeded = (_, res) => {
        const { body } = createResponse("error", {
            code: "error.api.rate_exceeded",
            context: {
                limit: env.rateLimitWindow
            }
        });
        return res.status(429).json(body);
    };

    /**
     * Rate limit key cache
     * Caches IP -> rate limit key mapping to reduce CPU usage
     * TTL is short (1 minute) to balance performance and security
     */
    const ipKeyCache = new Map();
    const IP_KEY_CACHE_TTL = CACHE_TTL.IP_KEY;

    /**
     * Generate rate limit key from request IP with caching
     * Uses HMAC to create a consistent key from IP address
     * 
     * @param {Object} req - Express request object
     * @returns {string} Rate limit key
     */
    const keyGenerator = (req) => {
        const ip = getIP(req);
        
        // Check cache first
        const cached = ipKeyCache.get(ip);
        if (cached) {
            if (Date.now() < cached.expiresAt) {
                return cached.key;
            }
            ipKeyCache.delete(ip);
        }

        // Generate new key
        const key = hashHmac(ip, 'rate').toString('base64url');
        
        // Cache the key
        ipKeyCache.set(ip, {
            key,
            expiresAt: Date.now() + IP_KEY_CACHE_TTL
        });

        return key;
    };

    // Cleanup expired IP key cache entries periodically
    setInterval(() => {
        const now = Date.now();
        for (const [ip, value] of ipKeyCache.entries()) {
            if (now >= value.expiresAt) {
                ipKeyCache.delete(ip);
            }
        }
    }, IP_KEY_CACHE_TTL);

    /**
     * Rate limiter for main API endpoint
     * Simple rate limiting for personal use
     */
    const apiLimiter = rateLimit({
        windowMs: env.rateLimitWindow * 1000,
        limit: env.rateLimitMax,
        standardHeaders: 'draft-6',
        legacyHeaders: false,
        keyGenerator, // Generate key from IP
        store: await createStore('api'),
        handler: handleRateExceeded
    });

    /**
     * Rate limiter for tunnel endpoint
     * Tunnel endpoint is used for streaming media, so it has higher limits
     */
    const apiTunnelLimiter = rateLimit({
        windowMs: env.tunnelRateLimitWindow * 1000,
        limit: env.tunnelRateLimitMax,
        standardHeaders: 'draft-6',
        legacyHeaders: false,
        keyGenerator: req => keyGenerator(req),
        store: await createStore('tunnel'),
        // Simple 429 response for tunnel (no JSON body needed)
        handler: (_, res) => {
            return res.sendStatus(429);
        }
    });

    // Trust proxy headers (for getting real client IP behind reverse proxy)
    // Only trust loopback and unique local addresses for security
    app.set('trust proxy', ['loopback', 'uniquelocal']);

    // Request ID middleware - adds unique ID to each request for tracing
    app.use((req, res, next) => {
        req.requestId = nanoid();
        req.logger = createChildLogger({ requestId: req.requestId });
        next();
    });

    // Request logging middleware
    app.use((req, res, next) => {
        const startTime = Date.now();
        
        // Log response when finished
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            logResponse(req, res, req.requestId, duration);
        });
        
        logRequest(req, req.requestId);
        next();
    });

    // Request timeout middleware - prevent long-running requests
    app.use(requestTimeout(env.requestTimeout));

    // CORS middleware - allows cross-origin requests
    // Simplified for personal use - allow all origins
    app.use('/', cors({
        methods: ['GET', 'POST'],
        exposedHeaders: [
            'Ratelimit-Limit',
            'Ratelimit-Policy',
            'Ratelimit-Remaining',
            'Ratelimit-Reset'
        ],
        origin: true, // Allow all origins for personal use
    }));

    // Validate Accept and Content-Type headers for POST requests
    // Ensures clients are sending proper JSON requests
    app.post('/', async (req, res, next) => {
        const acceptHeader = req.header('Accept');
        // If Accept header is present, it must be valid
        if (acceptHeader && !acceptRegex.test(acceptHeader)) {
            return await fail(res, "error.api.header.accept");
        }
        const contentTypeHeader = req.header('Content-Type');
        // Content-Type is required and must be valid
        if (!contentTypeHeader || !acceptRegex.test(contentTypeHeader)) {
            return await fail(res, "error.api.header.content_type");
        }
        next();
    });


    // Apply rate limiting to POST requests
    app.post('/', apiLimiter);
    
    // Parse JSON request body (max LIMITS.JSON_BODY_MAX_SIZE to prevent large payloads)
    app.use('/', express.json({ limit: LIMITS.JSON_BODY_MAX_SIZE }));

    // Error handler for JSON parsing errors
    app.use('/', (err, _, res, next) => {
        if (err) {
            // Invalid JSON or body too large
            const { status, body } = createResponse("error", {
                code: "error.api.invalid_body",
            });
            return res.status(status).json(body);
        }

        next();
    });


    /**
     * @swagger
     * /:
     *   post:
     *     summary: Extract media from URL
     *     description: |
     *       Main API endpoint to extract media (video/audio/images) from supported services.
     *       
     *       **Supported Services:**
     *       - YouTube, TikTok (videos, user profiles, playlists/mixes), Instagram, Twitter/X, Reddit, Facebook, SoundCloud, Bilibili, Xiaohongshu
     *       
     *       **Response Types:**
     *       - `redirect`: Direct download URL (no processing needed)
     *       - `tunnel`: Secure tunnel URL for streaming/downloading
     *       - `picker`: Multiple media options (user can choose)
     *       - `local-processing`: Server-side processing required (merge, remux, convert)
     *       
     *       **Example Request:**
     *       ```json
     *       {
     *         "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
     *         "videoQuality": "1080",
     *         "downloadMode": "auto",
     *         "audioFormat": "mp3",
     *         "audioBitrate": "320"
     *       }
     *       ```
     *     tags: [Media]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/MediaRequest'
     *           examples:
     *             youtube:
     *               summary: YouTube video
     *               value:
     *                 url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
     *                 videoQuality: "1080"
     *                 downloadMode: "auto"
     *             tiktok:
     *               summary: TikTok video
     *               value:
     *                 url: "https://www.tiktok.com/@user/video/1234567890"
     *                 videoQuality: "max"
     *                 tiktokFullAudio: true
     *             tiktokPlaylist:
     *               summary: TikTok playlist/mix
     *               value:
     *                 url: "https://www.tiktok.com/@username/playlist/playlist-name-1234567890"
     *                 videoQuality: "max"
     *                 downloadMode: "auto"
     *             tiktokProfile:
     *               summary: TikTok user profile
     *               value:
     *                 url: "https://www.tiktok.com/@username"
     *                 videoQuality: "max"
     *                 autoDownload: true
     *             audio:
     *               summary: Extract audio only
     *               value:
     *                 url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
     *                 downloadMode: "audio"
     *                 audioFormat: "mp3"
     *                 audioBitrate: "320"
     *     responses:
     *       200:
     *         description: Media extraction successful
     *         content:
     *           application/json:
     *             schema:
     *               oneOf:
     *                 - $ref: '#/components/schemas/SuccessResponse'
     *                 - type: object
     *                   properties:
     *                     status:
     *                       type: string
     *                       example: "picker"
     *                     count:
     *                       type: integer
     *                       description: Number of videos in the playlist
     *                       example: 73
     *                     picker:
     *                       type: array
     *                       items:
     *                         type: object
     *                         properties:
     *                           type:
     *                             type: string
     *                           url:
     *                             type: string
     *                           filename:
     *                             type: string
     *             examples:
     *               redirect:
     *                 summary: Direct redirect
     *                 value:
     *                   status: "redirect"
     *                   url: "https://example.com/video.mp4"
     *                   filename: "video.mp4"
     *               tunnel:
     *                 summary: Tunnel URL
     *                 value:
     *                   status: "tunnel"
     *                   url: "http://localhost:9000/tunnel?id=abc123&exp=1234567890&sig=xyz&sec=secret&iv=iv"
     *                   filename: "video.mp4"
     *               picker:
     *                 summary: Media picker (e.g., TikTok playlist)
     *                 value:
     *                   status: "picker"
     *                   picker:
     *                     - type: "video"
     *                       url: "http://localhost:9000/tunnel?id=video1"
     *                       filename: "tiktok_video1.mp4"
     *                     - type: "video"
     *                       url: "http://localhost:9000/tunnel?id=video2"
     *                       filename: "tiktok_video2.mp4"
     *       400:
     *         description: Invalid request or URL
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *             examples:
     *               invalidUrl:
     *                 summary: Invalid URL
     *                 value:
     *                   status: "error"
     *                   error:
     *                     code: "error.api.link.invalid"
     *               missingUrl:
     *                 summary: Missing URL
     *                 value:
     *                   status: "error"
     *                   error:
     *                     code: "error.api.link.missing"
     *       429:
     *         description: Rate limit exceeded
     *         headers:
     *           Ratelimit-Limit:
     *             description: Request limit per window
     *             schema:
     *               type: integer
     *           Ratelimit-Remaining:
     *             description: Remaining requests in current window
     *             schema:
     *               type: integer
     *           Ratelimit-Reset:
     *             description: Time when rate limit resets (Unix timestamp)
     *             schema:
     *               type: integer
     */
    /**
     * Main API endpoint - Extract media from URL
     * 
     * POST /
     * 
     * Request body: { url, videoQuality, downloadMode, ... }
     * Response: { status, url, filename, ... } or { error: { code, context } }
     */
    app.post('/', async (req, res) => {
        const request = req.body;

        // Validate URL is provided
        if (!request.url) {
            return await fail(res, "error.api.link.missing", {}, req.requestId);
        }

        // Validate URL size to prevent DoS attacks
        // URLs longer than LIMITS.URL_MAX_LENGTH are likely malicious or malformed
        if (request.url.length > LIMITS.URL_MAX_LENGTH) {
            return await fail(res, "error.api.link.too_long", {
                maxLength: LIMITS.URL_MAX_LENGTH
            }, req.requestId);
        }

        // Normalize and validate request parameters
        // This uses Zod schema validation to ensure all parameters are valid
        const { success, data: normalizedRequest } = await normalizeRequest(request);
        if (!success) {
            return await fail(res, "error.api.invalid_body", {}, req.requestId);
        }

        // Extract service and pattern match from URL
        const parsed = extract(
            normalizedRequest.url,
            env.enabledServices,
        );

        // Check if extraction failed
        if (!parsed) {
            return await fail(res, "error.api.link.invalid", {}, req.requestId);
        }

        // Check if extraction returned an error
        if ("error" in parsed) {
            let context;
            if (parsed?.context) {
                context = parsed.context;
            }
            return await fail(res, `error.api.${parsed.error}`, context, req.requestId);
        }

        // Process the request through service matching
        try {
            // Log autoDownload if present
            if (normalizedRequest.autoDownload) {
                logger.debug({ 
                    requestId: req.requestId,
                    autoDownload: normalizedRequest.autoDownload,
                    url: normalizedRequest?.url?.toString()
                }, 'Request has autoDownload enabled');
            }
            
            // Preserve raw URL string for encoding preservation (e.g., TikTok playlist names)
            const paramsWithOriginalRequest = {
                ...normalizedRequest,
                originalRequest: request.url, // Raw URL string before normalization
            };
            
            const result = await match({
                host: parsed.host, // Service name (e.g., "youtube", "tiktok")
                patternMatch: parsed.patternMatch, // Matched URL parameters
                params: paramsWithOriginalRequest, // User preferences with originalRequest
                authType: "none", // No authentication for personal use
                requestId: req.requestId, // Request ID for logging
            });

            // Return result - check if response already sent (timeout)
            if (!res.headersSent) {
                res.status(result.status).json(result.body);
            } else {
                logger.warn({
                    requestId: req.requestId,
                    url: normalizedRequest?.url?.toString(),
                    host: parsed?.host,
                }, 'Response already sent (timeout), skipping result');
            }
        } catch (error) {
            // Catch any unexpected errors during processing
            logError(error, {
                requestId: req.requestId,
                url: normalizedRequest?.url?.toString(),
                host: parsed?.host,
            });
            // Only send error if response not already sent
            if (!res.headersSent) {
                await fail(res, "error.api.generic", {}, req.requestId);
            }
        }
    });

    app.use('/tunnel', cors({
        methods: ['GET'],
        exposedHeaders: [
            'Estimated-Content-Length',
            'Content-Disposition'
        ],
        origin: true, // Allow all origins for personal use
    }));

    /**
     * @swagger
     * /tunnel:
     *   get:
     *     summary: Stream media through tunnel
     *     description: |
     *       Streams media files through a secure tunnel with encrypted parameters.
     *       
     *       This endpoint is used internally by the API to securely stream media files.
     *       The tunnel URL is returned from the POST / endpoint when media needs to be
     *       streamed through the server (for processing, CORS bypass, or security).
     *       
     *       **Security:**
     *       - All parameters are encrypted and signed
     *       - Streams expire after a set time (default: 5 minutes)
     *       - Parameters are validated before streaming
     *       
     *       **Usage:**
     *       Use the tunnel URL returned from POST / endpoint directly. You don't need to
     *       construct this URL manually.
     *     tags: [Stream]
     *     parameters:
     *       - in: query
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^.{21}$'
     *         description: Stream ID (21 characters)
     *         example: "abc123xyz789def456ghi"
     *       - in: query
     *         name: exp
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^[0-9]{13}$'
     *         description: Expiration timestamp (13 digits, Unix timestamp in milliseconds)
     *         example: "1703234567890"
     *       - in: query
     *         name: sig
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^.{43}$'
     *         description: HMAC signature (43 characters, base64url encoded)
     *       - in: query
     *         name: sec
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^.{43}$'
     *         description: Encryption secret (43 characters, base64url encoded)
     *       - in: query
     *         name: iv
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '^.{22}$'
     *         description: Initialization vector (22 characters, base64url encoded)
     *       - in: query
     *         name: p
     *         required: false
     *         schema:
     *           type: string
     *         description: Preflight check (returns 200 if tunnel is valid)
     *     responses:
     *       200:
     *         description: Stream successful
     *         headers:
     *           Content-Type:
     *             description: Media MIME type
     *             schema:
     *               type: string
     *               example: "video/mp4"
     *           Content-Disposition:
     *             description: Filename suggestion
     *             schema:
     *               type: string
     *               example: "attachment; filename=\"video.mp4\""
     *           Estimated-Content-Length:
     *             description: Estimated content length (if available)
     *             schema:
     *               type: string
     *         content:
     *           video/*:
     *             schema:
     *               type: string
     *               format: binary
     *           audio/*:
     *             schema:
     *               type: string
     *               format: binary
     *           image/*:
     *             schema:
     *               type: string
     *               format: binary
     *       400:
     *         description: Invalid parameters (missing, wrong length, or invalid format)
     *       401:
     *         description: Invalid signature (authentication failed)
     *       404:
     *         description: Stream not found or expired
     *       429:
     *         description: Rate limit exceeded
     */
    app.get('/tunnel', apiTunnelLimiter, async (req, res) => {
        const requestId = nanoid();
        
        try {
            const id = String(req.query.id);
            const exp = String(req.query.exp);
            const sig = String(req.query.sig);
            const sec = String(req.query.sec);
            const iv = String(req.query.iv);

            const checkQueries = id && exp && sig && sec && iv;
            const checkBaseLength = id.length === 21 && exp.length === 13;
            const checkSafeLength = sig.length === 43 && sec.length === 43 && iv.length === 22;

            if (!checkQueries || !checkBaseLength || !checkSafeLength) {
                return res.status(400).end();
            }

            if (req.query.p) {
                return res.status(200).end();
            }

            const streamInfo = await verifyStream(id, sig, exp, sec, iv);
            if (!streamInfo?.service) {
                logger.debug({ requestId, streamId: id, status: streamInfo?.status }, 'Stream verification failed');
                return res.status(streamInfo?.status || 404).end();
            }

            if (streamInfo.type === 'proxy') {
                streamInfo.range = req.headers['range'];
            }

            return stream(res, streamInfo);
        } catch (error) {
            logError(error, { 
                requestId, 
                streamId: req.query.id,
                errorMessage: error.message,
                errorStack: error.stack
            }, 'Tunnel endpoint error');
            if (!res.headersSent) {
                return res.status(500).end();
            }
        }
    });

    // Enhanced Swagger UI with custom styling
    const swaggerCustomCss = `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info { margin: 50px 0 }
        .swagger-ui .info .title { color: #3b82f6; font-size: 36px; margin-bottom: 10px }
        .swagger-ui .info .description { font-size: 16px; line-height: 1.6; color: #4b5563 }
        .swagger-ui .scheme-container { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0 }
        .swagger-ui .opblock.opblock-post { border-color: #3b82f6; background: rgba(59, 130, 246, 0.1) }
        .swagger-ui .opblock.opblock-get { border-color: #10b981; background: rgba(16, 185, 129, 0.1) }
        .swagger-ui .opblock-tag { font-size: 18px; font-weight: 600; color: #1f2937 }
        .swagger-ui .opblock-summary { font-weight: 500 }
        .swagger-ui .btn.execute { background-color: #3b82f6; border-color: #3b82f6 }
        .swagger-ui .btn.execute:hover { background-color: #2563eb }
        .swagger-ui .response-col_status { font-weight: 600 }
        .swagger-ui .model-box { background: #f9fafb; border-radius: 6px }
        .swagger-ui .parameter__name { font-weight: 600; color: #1f2937 }
        .swagger-ui .markdown { line-height: 1.8 }
        .swagger-ui .markdown p { margin: 12px 0; line-height: 1.8 }
        .swagger-ui .markdown code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px }
        .swagger-ui .markdown pre { background: #1f2937; color: #f9fafb; padding: 15px; border-radius: 6px; overflow-x: auto; line-height: 1.6 }
        .swagger-ui .markdown ul { margin: 12px 0; padding-left: 24px; line-height: 1.8 }
        .swagger-ui .markdown li { margin: 8px 0; line-height: 1.8 }
        .swagger-ui .markdown strong { font-weight: 600; color: #1f2937 }
        .swagger-ui .opblock-description-wrapper { line-height: 1.8 }
        .swagger-ui .opblock-description p { margin: 12px 0; line-height: 1.8 }
        .swagger-ui .opblock-description ul { margin: 12px 0; padding-left: 24px; line-height: 1.8 }
        .swagger-ui .opblock-description li { margin: 8px 0; line-height: 1.8 }
    `;

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: swaggerCustomCss,
        customSiteTitle: "Media Extraction API Documentation",
        customfavIcon: false,
        swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            filter: true,
            showExtensions: true,
            showCommonExtensions: true,
            docExpansion: 'list',
            defaultModelsExpandDepth: 2,
            defaultModelExpandDepth: 2,
        },
    }));

    /**
     * @swagger
     * /:
     *   get:
     *     summary: Get server information
     *     description: |
     *       Returns server information including:
     *       - API URL
     *       - Supported services list
     *       - Server start time
     *       
     *       This endpoint can be used to check if the API is running and what services are available.
     *     tags: [Info]
     *     responses:
     *       200:
     *         description: Server information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 api:
     *                   type: object
     *                   properties:
     *                     url:
     *                       type: string
     *                       description: API base URL
     *                       example: "http://localhost:9000"
     *                     services:
     *                       type: array
     *                       description: List of supported service names
     *                       items:
     *                         type: string
     *                       example: ["YouTube", "TikTok", "Instagram", "Twitter", "Reddit", "Facebook", "SoundCloud", "Bilibili", "Xiaohongshu"]
     *                     startTime:
     *                       type: string
     *                       description: Server start timestamp (Unix timestamp in milliseconds)
     *                       example: "1703234567890"
     *             examples:
     *               default:
     *                 summary: Server info example
     *                 value:
     *                   api:
     *                     url: "http://localhost:9000"
     *                     services: ["YouTube", "TikTok", "Instagram", "Twitter", "Reddit", "Facebook", "SoundCloud", "Bilibili", "Xiaohongshu"]
     *                     startTime: "1703234567890"
     */
    app.get('/', (_, res) => {
        res.type('json');
        res.status(200).send(env.envFile ? getServerInfo() : serverInfo);
    })

    /**
     * @swagger
     * /health:
     *   get:
     *     summary: Health check endpoint
     *     description: |
     *       Returns the health status of the API server including:
     *       - Overall health status (healthy/degraded/unhealthy)
     *       - Server uptime
     *       - Memory usage statistics
     *       - Redis connectivity (if configured)
     *       - Detailed system information (if ?detailed=true)
     *       
     *       This endpoint is useful for monitoring and load balancer health checks.
     *     tags: [Health]
     *     parameters:
     *       - in: query
     *         name: detailed
     *         schema:
     *           type: boolean
     *         description: Include detailed system information
     *     responses:
     *       200:
     *         description: Health status
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 status:
     *                   type: string
     *                   enum: [healthy, degraded, unhealthy]
     *                   description: Overall health status
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *                   description: Current server time
     *                 uptime:
     *                   type: object
     *                   description: Server uptime information
     *                 memory:
     *                   type: object
     *                   description: Memory usage statistics (in MB)
     *                 redis:
     *                   type: object
     *                   description: Redis connectivity status (if configured)
     *             examples:
     *               basic:
     *                 summary: Basic health check
     *                 value:
     *                   status: "healthy"
     *                   timestamp: "2024-01-15T10:30:00.000Z"
     *                   uptime:
     *                     seconds: 3600
     *                     minutes: 60
     *                     hours: 1
     *                     days: 0
     *                     formatted: "1h 0m"
     *                   memory:
     *                     rss: 150
     *                     heapTotal: 50
     *                     heapUsed: 30
     *                     external: 5
     *                   redis:
     *                     status: "healthy"
     *                     latency: 2
     */
    // Download management endpoints
    app.post('/download', apiLimiter, async (req, res) => {
        const requestId = nanoid();
        const childLogger = createChildLogger({ requestId });
        
        try {
            const { url, filename, headers } = req.body;
            
            if (!url || !filename) {
                return await fail(res, "error.api.invalid_body", {
                    message: "url and filename are required"
                }, requestId);
            }
            
            childLogger.debug({ url, filename }, 'Download request received');
            
            const result = await downloadFile(url, filename, { headers });
            
            if (result.success) {
                res.json({
                    success: true,
                    filename: result.filepath.split(path.sep).pop(),
                    filepath: result.filepath,
                    size: result.size,
                    url: `${env.apiURL}downloads/${result.filepath.split(path.sep).pop()}`
                });
            } else {
                return await fail(res, "error.api.fetch.fail", {
                    message: result.error || "Download failed"
                }, requestId);
            }
        } catch (error) {
            logError(error, { requestId }, 'Download endpoint error');
            return await fail(res, "error.api.fetch.fail", {
                message: error.message
            }, requestId);
        }
    });
    
    app.post('/download/batch', apiLimiter, async (req, res) => {
        const requestId = nanoid();
        const childLogger = createChildLogger({ requestId });
        
        try {
            const { files, concurrency = 3 } = req.body;
            
            if (!Array.isArray(files) || files.length === 0) {
                return await fail(res, "error.api.invalid_body", {
                    message: "files array is required"
                }, requestId);
            }
            
            childLogger.debug({ count: files.length, concurrency }, 'Batch download request received');
            
            const results = await downloadFiles(files, { concurrency });
            
            res.json({
                success: true,
                results,
                summary: {
                    total: results.length,
                    success: results.filter(r => r.success).length,
                    failed: results.filter(r => !r.success).length
                }
            });
        } catch (error) {
            logError(error, { requestId }, 'Batch download endpoint error');
            return await fail(res, "error.api.fetch.fail", {
                message: error.message
            }, requestId);
        }
    });
    
    app.get('/downloads', apiLimiter, async (req, res) => {
        const requestId = nanoid();
        
        try {
            const { maxAge } = req.query;
            const files = await listFiles({
                maxAge: maxAge ? parseInt(maxAge, 10) : undefined
            });
            
            res.json({
                success: true,
                files,
                count: files.length
            });
        } catch (error) {
            logError(error, { requestId }, 'List downloads error');
            return await fail(res, "error.api.fetch.fail", {
                message: error.message
            }, requestId);
        }
    });
    
    app.get('/downloads/:filename', apiLimiter, async (req, res) => {
        const requestId = nanoid();
        const { filename } = req.params;
        
        try {
            const fileInfo = await getFileInfo(filename);
            
            if (!fileInfo.exists) {
                return await fail(res, "error.api.fetch.empty", {
                    message: "File not found"
                }, requestId);
            }
            
            const { stream, size, contentType } = await getFileStream(filename);
            
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', size);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            
            stream.pipe(res);
        } catch (error) {
            logError(error, { requestId, filename }, 'Get download file error');
            return await fail(res, "error.api.fetch.fail", {
                message: error.message
            }, requestId);
        }
    });
    
    app.delete('/downloads/:filename', apiLimiter, async (req, res) => {
        const requestId = nanoid();
        const { filename } = req.params;
        
        try {
            const result = await deleteFile(filename);
            
            if (result.success) {
                res.json({ success: true, message: "File deleted" });
            } else {
                return await fail(res, "error.api.fetch.fail", {
                    message: result.error || "Failed to delete file"
                }, requestId);
            }
        } catch (error) {
            logError(error, { requestId, filename }, 'Delete download file error');
            return await fail(res, "error.api.fetch.fail", {
                message: error.message
            }, requestId);
        }
    });
    
    app.get('/health', async (req, res) => {
        try {
            const detailed = req.query.detailed === 'true' || req.query.detailed === '1';
            const health = await getHealthStatus(startTimestamp, detailed);
            
            // Return appropriate status code based on health
            const statusCode = health.status === 'healthy' ? 200 : 
                              health.status === 'degraded' ? 200 : 503;
            
            res.status(statusCode).json(health);
        } catch (error) {
            logError(error, { requestId: req.requestId }, 'Health check failed');
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: 'Health check failed',
            });
        }
    });

    // handle all express errors
    app.use(async (req, __, res, ___) => {
        return await fail(res, "error.api.generic", {}, req.requestId);
    })

    randomizeCiphers();
    setInterval(randomizeCiphers, NETWORK.CIPHER_SHUFFLE_INTERVAL);

    env.subscribe(['externalProxy', 'httpProxyValues'], () => {
        // TODO: remove env.externalProxy in a future version
        const options = {};
        if (env.externalProxy) {
            options.httpProxy = env.externalProxy;
        }

        setGlobalDispatcher(
            new EnvHttpProxyAgent(options)
        );
    });

    http.createServer(app).listen({
        port: env.apiPort,
        host: env.listenAddress,
        reusePort: env.instanceCount > 1 || undefined
    }, () => {
        // Setup cookies for services that need them (Instagram, Twitter, YouTube, etc.)
        if (env.cookiePath) {
            Cookies.setup(env.cookiePath);
        }

        // Setup YouTube session if configured
        if (env.ytSessionServer) {
            YouTubeSession.setup();
        }
        
        // Start download cleanup interval (logs internally)
        startCleanupInterval();
        
        /**
         * SERVER STARTUP SUMMARY
         * 
         * Display formatted startup information after all services are initialized.
         * This provides a clear overview of server configuration and status.
         * 
         * Note: Tunnel handler port is logged separately when it's ready.
         */
        const serviceList = [...env.enabledServices].map(e => friendlyServiceName(e)).join(', ');
        const listenAddress = env.listenAddress || '0.0.0.0';
        const tunnelPort = env.tunnelPort || 'initializing...';
        
        /**
         * Wait a brief moment for tunnel handler to initialize
         * Tunnel handler is set up asynchronously, so we wait to get the port
         */
        setTimeout(() => {
            const finalTunnelPort = env.tunnelPort || 'N/A';
            
            logger.info('\n' + '='.repeat(70));
            logger.info('  Media Extraction API - Server Started');
            logger.info('='.repeat(70));
            logger.info(`  Listening:     http://${listenAddress}:${env.apiPort}`);
            logger.info(`  API URL:       ${env.apiURL}`);
            if (finalTunnelPort !== 'N/A') {
                logger.info(`  Tunnel:        http://127.0.0.1:${finalTunnelPort}`);
            }
            logger.info(`  Environment:  ${process.env.NODE_ENV || 'development'}`);
            logger.info(`  Instances:     ${env.instanceCount}`);
            logger.info(`  Services:      ${env.enabledServices.size} enabled`);
            if (env.enabledServices.size > 0 && env.enabledServices.size <= 5) {
                logger.info(`                ${serviceList}`);
            }
            if (env.redisURL) {
                logger.info(`  Redis:         Enabled`);
            }
            logger.info('='.repeat(70));
            logger.info('  Server is ready to accept requests');
            logger.info('='.repeat(70) + '\n');
        }, 150);
    });

    setupTunnelHandler();
}
