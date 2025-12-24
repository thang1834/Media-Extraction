# Architecture

Tổng quan về kiến trúc của Media Extraction API.

## Overview

Media Extraction API là một Express.js application được thiết kế để extract và download media từ nhiều platforms khác nhau.

## System Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP Request
       ▼
┌─────────────────────────────────────┐
│      Express Middleware Chain        │
│  ┌──────────────────────────────┐   │
│  │ Request ID & Logging         │   │
│  ├──────────────────────────────┤   │
│  │ CORS                         │   │
│  ├──────────────────────────────┤   │
│  │ Request Timeout              │   │
│  ├──────────────────────────────┤   │
│  │ Authentication (Optional)     │   │
│  ├──────────────────────────────┤   │
│  │ Rate Limiting                │   │
│  └──────────────────────────────┘   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│        URL Processing               │
│  ┌──────────────────────────────┐   │
│  │ aliasURL() - Normalize       │   │
│  │ cleanURL() - Sanitize        │   │
│  │ extract() - Identify service │   │
│  └──────────────────────────────┘   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│      Service Matching                │
│  ┌──────────────────────────────┐   │
│  │ Validate pattern             │   │
│  │ Load service handler         │   │
│  │ Call handler                 │   │
│  │ Handle errors                │   │
│  └──────────────────────────────┘   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│      Action Matching                │
│  ┌──────────────────────────────┐   │
│  │ Determine response type      │   │
│  │ Create response              │   │
│  └──────────────────────────────┘   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────┐
│   Response  │
└─────────────┘
```

---

## Core Components

### 1. Entry Point (`src/api.js`)

- Loads environment variables
- Initializes Express app
- Sets up cluster mode (optional)
- Starts API server

### 2. API Layer (`src/core/api.js`)

- Express middleware setup
- Route handlers
- Error handling
- Swagger documentation

### 3. URL Processing (`src/processing/url.js`)

**Functions:**
- `aliasURL()` - Convert URL variants to canonical form
- `cleanURL()` - Remove unnecessary query params
- `extract()` - Identify service and match pattern

### 4. Service Matching (`src/processing/match.js`)

- Validates URL patterns
- Loads service handlers (lazy loading)
- Calls appropriate handler
- Handles errors
- Caches metadata

### 5. Service Handlers (`src/processing/services/`)

Mỗi service có handler riêng:
- Fetches media metadata
- Extracts video/audio URLs
- Handles authentication
- Returns structured data

### 6. Action Matching (`src/processing/match-action.js`)

Determines response type:
- `redirect` - Direct download
- `tunnel` - Proxy through server
- `picker` - Multi-media selection
- `local-processing` - Server-side processing

### 7. Streaming (`src/stream/`)

- `stream.js` - Stream handling
- `manage.js` - Stream lifecycle
- `proxy.js` - Media proxying
- `ffmpeg.js` - Media processing

---

## Data Flow

### Single Video Request

```
1. Client sends POST / with URL
2. URL normalized và extracted
3. Service identified (e.g., "youtube")
4. Service handler called
5. Media URLs extracted
6. Action determined (redirect/tunnel/local-processing)
7. Response sent to client
```

### Multi-Media Request (Picker)

```
1. Client sends POST / with URL
2. Service handler detects multiple media
3. Returns picker array
4. Client shows UI để user chọn
5. User selects media
6. Client downloads selected media
```

### Local Processing Request

```
1. Client sends POST / with processing requirements
2. Service handler returns video + audio URLs
3. Action determined as "local-processing"
4. Server creates tunnel URLs
5. Client requests processing
6. Server downloads, processes, và streams result
```

---

## Caching Strategy

### Metadata Cache

- **Type:** LRU Cache
- **Size:** 1000 entries
- **TTL:** 5 minutes
- **Content:** Metadata only (no URLs)
- **Purpose:** Reduce load on external services

### IP Key Cache

- **Type:** In-memory Map
- **TTL:** 1 minute
- **Purpose:** Reduce CPU usage for rate limiting

### Stream Cache

- **Type:** Redis or Memory Store
- **TTL:** Configurable (default: 90 seconds)
- **Purpose:** Store encrypted stream data

---

## Security Architecture

### Authentication

1. **API Keys:**
   - Fetched from external URL
   - IP whitelist support
   - Service restrictions
   - Custom rate limits

2. **JWT Sessions:**
   - IP-bound
   - Expiration time
   - Turnstile verification

### Rate Limiting

- 3 tiers: Session, API, Tunnel
- Redis-backed (optional)
- IP-based hoặc key-based
- Configurable limits

### Stream Security

- Encrypted parameters
- HMAC signatures
- Expiration timestamps
- Request ID tracking

---

## Error Handling Flow

```
Service Handler Error
    ↓
Error Handler (src/processing/error-handler.js)
    ↓
Error Code Mapping
    ↓
Context Generation
    ↓
Error Response
    ↓
Client
```

---

## Performance Optimizations

1. **Lazy Loading:** Service handlers chỉ load khi cần
2. **Metadata Caching:** Cache metadata để giảm external requests
3. **Connection Pooling:** Reuse connections cho external requests
4. **Stream Cleanup:** Automatic cleanup expired streams
5. **IP Key Caching:** Cache rate limit keys

---

## Scalability

### Single Instance

- Suitable cho development
- Memory-based rate limiting
- No shared state

### Multi-Instance

- Requires Redis
- Shared rate limiting
- Load balancing support
- SO_REUSEPORT support (Node.js >= 23.1.0)

---

## Monitoring

### Health Checks

- `/health` endpoint
- Memory usage
- Redis connectivity
- Uptime tracking

### Logging

- Structured logging với pino
- Request ID tracking
- Error tracking với Sentry (optional)

### Metrics

- Request rate
- Error rate
- Response times
- Cache hit rates

---

## Extension Points

1. **New Services:** Add handler trong `src/processing/services/`
2. **New Response Types:** Extend `match-action.js`
3. **Custom Processing:** Add trong `src/stream/`
4. **Authentication:** Extend `src/security/`

