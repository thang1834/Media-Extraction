# Configuration

Hướng dẫn cấu hình Media Extraction API.

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `API_URL` | Base URL của API | `http://localhost:9000` |

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `9000` | Port để listen |
| `API_LISTEN_ADDRESS` | all interfaces | Address để bind |
| `API_INSTANCE_COUNT` | `1` | Số instances (cần Redis nếu > 1) |
| `API_ENV_FILE` | - | Path đến `.env` file cho hot-reload |

### CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_WILDCARD` | `1` | Allow all origins (`1` hoặc `0`) |
| `CORS_URL` | - | Allowed CORS origin (nếu `CORS_WILDCARD=0`) |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATELIMIT_WINDOW` | `60` | Rate limit window (seconds) |
| `RATELIMIT_MAX` | `20` | Max requests per window |
| `TUNNEL_RATELIMIT_WINDOW` | `60` | Tunnel rate limit window |
| `TUNNEL_RATELIMIT_MAX` | `40` | Tunnel max requests |
| `SESSION_RATELIMIT_WINDOW` | `60` | Session rate limit window |
| `SESSION_RATELIMIT_MAX` | `10` | Session max requests |

### Request Timeout

| Variable | Default | Description |
|----------|---------|-------------|
| `REQUEST_TIMEOUT` | `30000` | Request timeout (milliseconds) |

### Authentication

| Variable | Description |
|----------|-------------|
| `API_KEY_URL` | URL để fetch API keys |
| `API_AUTH_REQUIRED` | Require authentication (`1` hoặc `0`) |
| `TURNSTILE_SITEKEY` | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret |
| `JWT_SECRET` | JWT signing secret (generate với `npm run token:jwt`) |
| `JWT_EXPIRY` | JWT lifetime (minutes, default: `120`) |

### Services

| Variable | Description |
|----------|-------------|
| `DISABLED_SERVICES` | Comma-separated list của disabled services |

### YouTube

| Variable | Default | Description |
|----------|---------|-------------|
| `CUSTOM_INNERTUBE_CLIENT` | - | Custom InnerTube client |
| `YOUTUBE_SESSION_SERVER` | - | YouTube session server URL |
| `YOUTUBE_SESSION_INNERTUBE_CLIENT` | - | Session InnerTube client |
| `YOUTUBE_ALLOW_BETTER_AUDIO` | `1` | Allow better audio quality (`1` hoặc `0`) |

### Processing

| Variable | Default | Description |
|----------|---------|-------------|
| `FORCE_LOCAL_PROCESSING` | `"never"` | Force local processing: `"never"`, `"session"`, `"always"` |
| `ENABLE_DEPRECATED_YOUTUBE_HLS` | `"never"` | Enable deprecated YouTube HLS: `"never"`, `"key"`, `"always"` |
| `DURATION_LIMIT` | `10800` | Maximum video duration (seconds, 3 hours) |
| `TUNNEL_LIFESPAN` | `90` | Tunnel stream lifespan (seconds). **Recommended:** `600` (10 minutes) for TikTok playlist downloads to prevent tunnel expiration |
| `PROCESSING_PRIORITY` | - | Process priority (Unix only) |

### Proxy

| Variable | Description |
|----------|-------------|
| `HTTP_PROXY` | HTTP proxy URL |
| `HTTPS_PROXY` | HTTPS proxy URL |
| `API_EXTERNAL_PROXY` | External proxy URL (deprecated) |
| `FREEBIND_CIDR` | Freebind CIDR range (Linux only) |

### Storage

| Variable | Description |
|----------|-------------|
| `API_REDIS_URL` | Redis URL cho rate limiting (optional) |
| `COOKIE_PATH` | Path đến cookie storage directory |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | - | Node environment: `development`, `production` |

### Error Tracking (Sentry)

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | Sentry DSN cho error tracking |
| `SENTRY_ENVIRONMENT` | Sentry environment |
| `SENTRY_RELEASE` | Sentry release version |
| `SENTRY_SAMPLE_RATE` | Sentry sample rate (`0.0` to `1.0`) |

---

## Example `.env` File

```env
# Required
API_URL=http://localhost:9000

# Server
API_PORT=9000

# CORS
CORS_WILDCARD=1

# Rate Limiting
RATELIMIT_WINDOW=60
RATELIMIT_MAX=20

# Request Timeout
REQUEST_TIMEOUT=30000

# Authentication (optional)
TURNSTILE_SITEKEY=your_site_key
TURNSTILE_SECRET=your_secret
JWT_SECRET=your_jwt_secret
JWT_EXPIRY=120

# YouTube
YOUTUBE_ALLOW_BETTER_AUDIO=1

# Processing
FORCE_LOCAL_PROCESSING=never
DURATION_LIMIT=10800
TUNNEL_LIFESPAN=600  # 10 minutes (recommended for playlist downloads)

# Storage (optional)
API_REDIS_URL=redis://localhost:6379
COOKIE_PATH=./cookies

# Logging
LOG_LEVEL=info
NODE_ENV=production

# Error Tracking (optional)
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_ENVIRONMENT=production
```

---

## Configuration Validation

Server sẽ validate configuration khi start. Nếu có lỗi, server sẽ không start và hiển thị error message.

**Common Validation Errors:**
- `API_URL is required` - Thiếu API_URL
- `API_PORT must be between 1 and 65535` - Port không hợp lệ
- `REQUEST_TIMEOUT must be at least 1000ms` - Timeout quá ngắn
- `JWT_SECRET must be at least 16 characters` - JWT secret quá ngắn
- `API_REDIS_URL is required when API_INSTANCE_COUNT > 1` - Cần Redis cho multi-instance

---

## Hot Reload

Nếu `API_ENV_FILE` được set, server sẽ watch file và tự động reload environment variables khi file thay đổi.

**Usage:**
```env
API_ENV_FILE=.env
```

Server sẽ reload config mà không cần restart.

---

## Generating JWT Secret

Generate JWT secret an toàn:

```bash
npm run token:jwt
```

Copy output và thêm vào `.env`:
```env
JWT_SECRET=<generated_secret>
```

---

## Redis Configuration

Redis được dùng cho:
- Rate limiting (shared across instances)
- Stream cache storage

**Format:**
```env
API_REDIS_URL=redis://localhost:6379
# hoặc
API_REDIS_URL=redis://user:password@host:port
```

**Required khi:**
- `API_INSTANCE_COUNT > 1` (multi-instance)
- Cần shared rate limiting

---

## Proxy Configuration

### HTTP/HTTPS Proxy

```env
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=https://proxy.example.com:8080
```

### Freebind (Linux only)

Bind to specific IP addresses:

```env
FREEBIND_CIDR=192.168.1.0/24
```

---

## Production Recommendations

1. **Set `NODE_ENV=production`** - Enable production optimizations
2. **Use Redis** - For shared rate limiting và caching
3. **Set `LOG_LEVEL=info`** - Reduce log verbosity
4. **Configure Sentry** - For error tracking
5. **Set appropriate timeouts** - Based on your use case
6. **Use API keys** - For authentication và access control
7. **Enable health checks** - For monitoring

