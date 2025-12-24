# Media Extraction API

A powerful, self-hosted API for extracting and downloading media from various platforms including YouTube, TikTok, Instagram, Twitter/X, and more.

## ✨ Features

- **Multi-Platform Support**: YouTube, TikTok, Instagram, Twitter/X, Facebook, Reddit, Bilibili, SoundCloud, Xiaohongshu
- **Auto-Download**: Automatically download videos/audio to server with organized folder structure
- **High Quality**: Support for 8K, 4K, HDR, and various codecs (h264, av1, vp9)
- **Playlist Support**: Download entire playlists/mixes with proper organization
- **Metadata Extraction**: Rich metadata including titles, descriptions, thumbnails
- **Subtitle Support**: Extract and download subtitles/captions
- **RESTful API**: Simple JSON-based API with Swagger documentation
- **Rate Limiting**: Built-in rate limiting to prevent abuse
- **Session Management**: Optional session support for authenticated requests
- **Cluster Mode**: Multi-instance support for high availability

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18
- **npm** or **pnpm**

### Installation

```bash
# Clone repository
git clone <repository-url>
cd Media-Extraction

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env and set at minimum:
# API_URL=http://localhost:9000
# API_PORT=9000

# Start server
npm start
```

Server will be available at `http://localhost:9000`

### Basic Usage

#### Download YouTube Video

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "videoQuality": "1080"
  }'
```

#### Download TikTok Playlist (Auto-Download)

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.tiktok.com/@username/playlist/playlist-name-1234567890",
    "videoQuality": "max",
    "downloadMode": "auto"
  }'
```

## 📚 Documentation

Full documentation is available in the [`docs/`](docs/) directory:

- **[Getting Started](docs/getting-started.md)** - Installation and setup guide
- **[API Reference](docs/api-reference.md)** - Complete API documentation
- **[Configuration](docs/configuration.md)** - Environment variables and settings
- **[Services](docs/services.md)** - Supported platforms and features
- **[Examples](docs/examples.md)** - Code examples for common use cases
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

### Interactive API Documentation

When the server is running, visit:
- **Swagger UI**: `http://localhost:9000/api-docs`
- **Health Check**: `http://localhost:9000/health`

## 🎯 Supported Services

| Service | Video | Audio | Playlists | Metadata | Notes |
|---------|:-----:|:-----:|:---------:|:--------:|-------|
| YouTube | ✅ | ✅ | ✅ | ✅ | 8K, HDR, Subtitles |
| TikTok | ✅ | ✅ | ✅ | ❌ | Playlists, User profiles |
| Instagram | ✅ | ✅ | ✅ | ❌ | Posts, Reels, Stories |
| Twitter/X | ✅ | ✅ | ✅ | ❌ | Tweets, Spaces |
| Facebook | ✅ | ❌ | ❌ | ❌ | Videos only |
| Reddit | ✅ | ✅ | ❌ | ❌ | Videos, GIFs |
| Bilibili | ✅ | ✅ | ❌ | ❌ | Chinese platform |
| SoundCloud | ❌ | ✅ | ❌ | ✅ | Audio only |
| Xiaohongshu | ✅ | ✅ | ✅ | ❌ | Chinese platform |

See [Services Documentation](docs/services.md) for detailed information about each platform.

## 🔧 Configuration

Key environment variables:

```env
# Required
API_URL=http://localhost:9000
API_PORT=9000

# Optional
REQUEST_TIMEOUT=120000          # Request timeout in ms
TUNNEL_LIFESPAN=600             # Tunnel URL lifespan (10 min for playlists)
API_INSTANCE_COUNT=1            # Number of instances (cluster mode)
API_REDIS_URL=                  # Redis URL for rate limiting (optional)
```

See [Configuration Guide](docs/configuration.md) for all available options.

## 📁 Download Structure

When using auto-download mode, files are organized as:

```
downloads/
├── youtube/
│   └── channel-name/
│       └── video-title.mp4
├── tiktok/
│   └── username/
│       └── playlist-name/
│           └── tiktok_playlist_username_001_videoId.mp4
└── instagram/
    └── username/
        └── post-id.mp4
```

## 🛠️ Development

### Project Structure

```
Media-Extraction/
├── src/
│   ├── core/           # Core API setup
│   ├── processing/     # Service handlers
│   ├── util/           # Utilities
│   └── api.js          # Entry point
├── docs/               # Documentation
├── downloads/          # Auto-downloaded files
└── package.json
```

### Scripts

```bash
npm start              # Start server
npm test               # Run tests
npm run token:jwt      # Generate JWT secret
```

See [Development Guide](docs/development.md) for more information.

## 🔒 Security

- Rate limiting to prevent abuse
- Request timeout protection
- CORS configuration
- Input validation
- Secure cookie handling

## 🤝 Contributing

Contributions are welcome! Please read the [Development Guide](docs/development.md) before submitting PRs.

## 🐛 Troubleshooting

Common issues and solutions:

- **403 Forbidden errors**: Check cookies/authentication for protected content
- **404 errors on downloads**: URLs may have expired, retry logic handles this
- **Rate limiting**: Adjust delays between requests in configuration
- **Tunnel expiration**: Increase `TUNNEL_LIFESPAN` for long playlists

See [Troubleshooting Guide](docs/troubleshooting.md) for more help.

## 📞 Support

- Check [Documentation](docs/README.md) for detailed guides
- Review [Examples](docs/examples.md) for code samples
- See [Troubleshooting](docs/troubleshooting.md) for common issues

---

**Note**: This API is for personal use and educational purposes. Respect the terms of service of the platforms you're extracting from.

