import swaggerJsdoc from "swagger-jsdoc";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "../..");

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Media Extraction API",
            version: "1.0.0",
            description: `
# Media Extraction API

A powerful API for extracting media (videos, audio, images) from various social media platforms.

## Supported Services

- **YouTube** - Videos, playlists, shorts
- **TikTok** - Videos with watermark removal, user profiles, playlists/mixes
- **Instagram** - Posts, reels, stories
- **Twitter/X** - Videos, images
- **Reddit** - Videos, images
- **Facebook** - Videos, posts
- **SoundCloud** - Audio tracks
- **Bilibili** - Videos, anime content
- **Xiaohongshu** - Chinese social media content

## Features

- 🎥 Video extraction with quality selection
- 🎵 Audio extraction with format conversion
- 🖼️ Image extraction
- 📝 Subtitle support
- 🔒 Secure tunnel streaming
- ⚡ Fast and efficient processing

## Rate Limiting

All endpoints are rate-limited to ensure fair usage. Check response headers for rate limit information.
            `,
            contact: {
                name: "API Support",
            },
        },
        servers: [
            {
                url: process.env.API_URL || "http://localhost:9000",
                description: "API Server",
            },
        ],
        tags: [
            {
                name: "Media",
                description: "Media extraction endpoints",
            },
            {
                name: "Stream",
                description: "Streaming and tunnel endpoints",
            },
            {
                name: "Info",
                description: "Server information endpoints",
            },
        ],
        components: {
            schemas: {
                MediaRequest: {
                    type: "object",
                    required: ["url"],
                    properties: {
                        url: {
                            type: "string",
                            description: "URL of the media to extract",
                            example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                        },
                        videoQuality: {
                            type: "string",
                            enum: ["max", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144"],
                            default: "1080",
                            description: "Video quality preference",
                        },
                        downloadMode: {
                            type: "string",
                            enum: ["auto", "audio", "mute"],
                            default: "auto",
                            description: "Download mode: auto (video), audio (extract audio only), mute (remove audio)",
                        },
                        audioFormat: {
                            type: "string",
                            enum: ["best", "mp3", "ogg", "wav", "opus"],
                            default: "mp3",
                            description: "Audio format for audio extraction",
                        },
                        audioBitrate: {
                            type: "string",
                            enum: ["max", "320", "256", "128", "96", "64", "8"],
                            default: "128",
                            description: "Audio bitrate in kbps (max = 320 kbps)",
                        },
                        filenameStyle: {
                            type: "string",
                            enum: ["classic", "pretty", "basic", "nerdy"],
                            default: "basic",
                            description: "Filename generation style",
                        },
                        localProcessing: {
                            type: "string",
                            enum: ["disabled", "preferred", "forced"],
                            default: "disabled",
                            description: "Enable server-side processing (merge, remux, convert)",
                        },
                        disableMetadata: {
                            type: "boolean",
                            default: false,
                            description: "Disable metadata extraction (title, author, etc.)",
                        },
                        allowH265: {
                            type: "boolean",
                            default: false,
                            description: "Allow H.265/HEVC codec",
                        },
                        convertGif: {
                            type: "boolean",
                            default: true,
                            description: "Convert animated GIFs to video",
                        },
                        alwaysProxy: {
                            type: "boolean",
                            default: false,
                            description: "Always proxy through server (even for direct URLs)",
                        },
                        youtubeVideoCodec: {
                            type: "string",
                            enum: ["h264", "av1", "vp9"],
                            default: "h264",
                            description: "YouTube video codec preference",
                        },
                        youtubeVideoContainer: {
                            type: "string",
                            enum: ["auto", "mp4", "webm", "mkv"],
                            default: "auto",
                            description: "YouTube video container format",
                        },
                        youtubeHLS: {
                            type: "boolean",
                            default: false,
                            description: "Use HLS streams for YouTube (for live streams)",
                        },
                        youtubeBetterAudio: {
                            type: "boolean",
                            default: false,
                            description: "Use better audio quality for YouTube",
                        },
                        youtubeDubLang: {
                            type: "string",
                            pattern: "^[0-9a-zA-Z\\-]+$",
                            minLength: 2,
                            maxLength: 8,
                            description: "YouTube dub language code (e.g., 'en', 'vi')",
                        },
                        subtitleLang: {
                            type: "string",
                            pattern: "^[0-9a-zA-Z\\-]+$",
                            minLength: 2,
                            maxLength: 8,
                            description: "Subtitle language code (e.g., 'en', 'vi')",
                        },
                        tiktokFullAudio: {
                            type: "boolean",
                            default: false,
                            description: "Use original audio for TikTok (no watermark). For user profiles and playlists, this applies to all videos.",
                        },
                        autoDownload: {
                            type: "boolean",
                            default: false,
                            description: "Automatically download media to server's downloads folder. Files are organized by service and username (e.g., downloads/tiktok/username/video.mp4). For TikTok user profiles and playlists, all available videos will be downloaded. You can also use downloadMode: 'auto' which is equivalent to autoDownload: true.",
                        },
                    },
                },
                ErrorResponse: {
                    type: "object",
                    properties: {
                        status: {
                            type: "string",
                            example: "error",
                        },
                        error: {
                            type: "object",
                            properties: {
                                code: {
                                    type: "string",
                                    example: "error.api.link.invalid",
                                },
                                context: {
                                    type: "object",
                                    description: "Additional error context",
                                },
                            },
                        },
                    },
                },
                SuccessResponse: {
                    type: "object",
                    properties: {
                        status: {
                            type: "string",
                            enum: ["redirect", "tunnel", "picker", "local-processing"],
                        },
                        url: {
                            type: "string",
                            description: "Direct URL or tunnel URL",
                        },
                        filename: {
                            type: "string",
                            description: "Suggested filename",
                        },
                        count: {
                            type: "integer",
                            description: "Number of items in picker (only for picker responses)",
                            example: 73,
                        },
                    },
                },
            },
        },
    },
    apis: [join(rootDir, "src/core/api.js")],
};

export const swaggerSpec = swaggerJsdoc(options);
