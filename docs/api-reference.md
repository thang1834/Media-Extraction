# API Reference

Tài liệu chi tiết về các API endpoints và cách sử dụng.

## Base URL

```
http://localhost:9000
```

## Endpoints

### GET `/`

Lấy thông tin server và danh sách services được hỗ trợ.

**Response:**
```json
{
  "api": {
    "url": "http://localhost:9000",
    "startTime": "1703234567890",
    "services": ["YouTube", "TikTok", "Instagram", ...]
  }
}
```

### GET `/health`

Health check endpoint để kiểm tra trạng thái server.

**Query Parameters:**
- `detailed` (optional): `true` để lấy thông tin chi tiết

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": {
    "seconds": 3600,
    "minutes": 60,
    "hours": 1,
    "days": 0,
    "formatted": "1h 0m"
  },
  "memory": {
    "rss": 150,
    "heapTotal": 50,
    "heapUsed": 30,
    "external": 5
  },
  "redis": {
    "status": "healthy",
    "latency": 2
  }
}
```

**Status Codes:**
- `200` - Healthy
- `200` - Degraded (Redis down nhưng server vẫn chạy)
- `503` - Unhealthy

### POST `/`

Main endpoint để extract media từ URL.

**Headers:**
```
Content-Type: application/json
Accept: application/json
```

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "videoQuality": "1080",
  "downloadMode": "auto",
  "audioFormat": "mp3",
  "audioBitrate": "128",
  "autoDownload": false
}
```

Xem [Request Parameters](#request-parameters) để biết tất cả các parameters.

**Response Types:**

1. **Redirect** - Direct download URL
2. **Tunnel** - Proxy URL với expiration
3. **Picker** - Multiple media options
4. **Local Processing** - Server-side processing required
5. **Error** - Error response

Xem [Response Formats](response-formats.md) để biết chi tiết.

### GET `/tunnel`

Stream media qua secure tunnel. URL này được trả về từ POST `/` endpoint.

**Query Parameters:**
- `id` - Stream ID (21 characters)
- `exp` - Expiration timestamp (13 digits)
- `sig` - HMAC signature (43 characters)
- `sec` - Encryption secret (43 characters)
- `iv` - Initialization vector (22 characters)
- `p` (optional) - Preflight check

**Response:**
- Streams media file với appropriate headers
- Supports range requests cho video seeking

### POST `/session`

Tạo JWT session token (requires Turnstile verification).

**Headers:**
```
cf-turnstile-response: TURNSTILE_TOKEN
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### GET `/api-docs`

Swagger UI documentation (nếu enabled).

---

## Request Parameters

### Required

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | URL của media cần extract |

### Optional

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `videoQuality` | enum | `"1080"` | Video quality: `"max"`, `"4320"`, `"2160"`, `"1440"`, `"1080"`, `"720"`, `"480"`, `"360"`, `"240"`, `"144"` |
| `downloadMode` | enum | `"auto"` | Download mode: `"auto"`, `"audio"`, `"mute"` |
| `audioFormat` | enum | `"mp3"` | Audio format: `"best"`, `"mp3"`, `"ogg"`, `"wav"`, `"opus"` |
| `audioBitrate` | enum | `"128"` | Audio bitrate: `"320"`, `"256"`, `"128"`, `"96"`, `"64"`, `"8"` |
| `filenameStyle` | enum | `"basic"` | Filename style: `"classic"`, `"pretty"`, `"basic"`, `"nerdy"` |
| `localProcessing` | enum | `"disabled"` | Local processing: `"disabled"`, `"preferred"`, `"forced"` |
| `disableMetadata` | boolean | `false` | Disable metadata extraction |
| `allowH265` | boolean | `false` | Allow H.265 codec |
| `convertGif` | boolean | `true` | Convert GIFs to video |
| `alwaysProxy` | boolean | `false` | Always proxy through server |
| `youtubeVideoCodec` | enum | `"h264"` | YouTube codec: `"h264"`, `"av1"`, `"vp9"` |
| `youtubeVideoContainer` | enum | `"auto"` | YouTube container: `"auto"`, `"mp4"`, `"webm"`, `"mkv"` |
| `youtubeDubLang` | string | optional | YouTube dub language code |
| `subtitleLang` | string | optional | Subtitle language code |
| `tiktokFullAudio` | boolean | `false` | Use full audio for TikTok |
| `youtubeHLS` | boolean | `false` | Use YouTube HLS (deprecated) |
| `youtubeBetterAudio` | boolean | `false` | Use better audio quality for YouTube Music |
| `autoDownload` | boolean | `false` | Automatically download media to server's downloads folder. Files are organized by service and username (e.g., `downloads/tiktok/username/video.mp4`) |

---

## Response Status Codes

- `200` - Success
- `400` - Bad Request (invalid URL, missing parameters, etc.)
- `401` - Unauthorized (invalid authentication)
- `404` - Not Found (stream expired, etc.)
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error
- `503` - Service Unavailable (health check failed)

---

## Rate Limiting

API có 3 tầng rate limiting:

1. **Session Rate Limiter**: `/session` endpoint
   - Default: 10 requests per 60 seconds per IP

2. **API Rate Limiter**: Main `/` endpoint
   - Default: 20 requests per 60 seconds per IP/key
   - Có thể customize per API key

3. **Tunnel Rate Limiter**: `/tunnel` endpoint
   - Default: 40 requests per 60 seconds per IP

**Rate Limit Headers:**
- `Ratelimit-Limit` - Maximum requests allowed
- `Ratelimit-Remaining` - Remaining requests
- `Ratelimit-Reset` - Reset timestamp

---

## Authentication

### API Key Authentication

Nếu `API_KEY_URL` được cấu hình:

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"url": "..."}'
```

### JWT Session Authentication

1. **Get Session Token:**
```bash
curl -X POST http://localhost:9000/session \
  -H "cf-turnstile-response: TURNSTILE_TOKEN"
```

2. **Use Session Token:**
```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -d '{"url": "..."}'
```

---

## Error Responses

Tất cả errors trả về format:

```json
{
  "status": "error",
  "error": {
    "code": "error.api.link.invalid",
    "context": {
      "service": "YouTube"
    }
  }
}
```

Xem [Error Handling](error-handling.md) để biết tất cả error codes.

---

## Swagger Documentation

Truy cập Swagger UI để xem interactive API documentation:

```
http://localhost:9000/api-docs
```

