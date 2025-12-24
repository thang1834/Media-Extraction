# Development Guide

Hướng dẫn phát triển và mở rộng Media Extraction API.

## Project Structure

```
src/
├── api.js                 # Entry point
├── config.js              # Configuration loader
├── core/
│   ├── api.js            # API routes & middleware
│   ├── env.js            # Environment variable management
│   ├── itunnel.js        # Internal tunnel handler
│   └── swagger.js        # Swagger documentation
├── processing/
│   ├── match.js          # Service matching logic
│   ├── match-action.js   # Action determination
│   ├── url.js            # URL processing
│   ├── schema.js         # Request validation schema
│   ├── request.js        # Request/response utilities
│   ├── service-config.js # Service configurations
│   ├── service-patterns.js # Pattern validators
│   ├── service-registry.js # Service registry
│   └── services/         # Service handlers
├── stream/               # Streaming & processing
├── security/             # Authentication & security
├── store/                # Rate limiting storage
└── util/                 # Utilities
```

---

## Adding a New Service

### Step 1: Create Service Handler

Tạo file `src/processing/services/newservice.js`:

```javascript
export default async function({ id, ...params }) {
    // Fetch media metadata
    const response = await fetch(`https://service.com/api/video/${id}`);
    const data = await response.json();
    
    // Extract video/audio URLs
    const videoUrl = data.videoUrl;
    const audioUrl = data.audioUrl;
    
    // Return structured data
    return {
        urls: videoUrl, // or [videoUrl, audioUrl] for merge
        filename: `service_${id}.mp4`,
        filenameAttributes: { // for rich filenames
            title: data.title,
            author: data.author,
        },
        fileMetadata: { // optional
            title: data.title,
            author: data.author,
            description: data.description,
        },
        subtitles: data.subtitles, // optional
        cover: data.thumbnail, // optional
        isHLS: false,
        isAudioOnly: false,
        isGif: false,
        isPhoto: false,
        picker: [], // for multi-media
        type: "proxy", // "proxy" | "merge" | "remux"
    };
}
```

### Step 2: Add Service Config

Thêm vào `src/processing/service-config.js`:

```javascript
newservice: {
    patterns: [
        "video/:id",
        "watch/:id"
    ],
    subdomains: ["m", "www"],
    altDomains: ["newsite.com"],
    tld: "com"
}
```

### Step 3: Add Pattern Tester

Thêm vào `src/processing/service-patterns.js`:

```javascript
"newservice": pattern =>
    pattern.id?.length <= 20
```

### Step 4: Add to Service Registry

Thêm vào `src/processing/service-registry.js`:

```javascript
newservice: {
    paramsMapper: (patternMatch, params, context) => ({
        id: patternMatch.id,
        dispatcher: context.dispatcher,
        // ... other params
    }),
}
```

### Step 5: Update URL Aliases (if needed)

Thêm vào `src/processing/url-normalizers.js` nếu có short links:

```javascript
// newservice.com/short/ABC123 -> newservice.com/watch/ABC123
```

### Step 6: Add Test File

Tạo `src/util/tests/newservice.json`:

```json
{
  "test1": {
    "url": "https://newservice.com/watch/123"
  }
}
```

---

## Running Tests

```bash
npm test
```

Tests được định nghĩa trong `src/util/tests/` dưới dạng JSON files.

---

## Code Style

- Use ES modules (`import`/`export`)
- Follow existing code style
- Add JSDoc comments cho functions
- Use descriptive variable names

---

## Debugging

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

### Check Request Flow

1. Check logs với request ID
2. Trace request qua các middleware
3. Check service handler response

### Common Debug Points

- URL extraction: `src/processing/url.js`
- Service matching: `src/processing/match.js`
- Action matching: `src/processing/match-action.js`
- Service handler: `src/processing/services/[service].js`

---

## Performance Optimization

1. **Use Redis** cho rate limiting và caching
2. **Enable metadata caching** (đã có sẵn)
3. **Lazy load service handlers** (đã implement)
4. **Use connection pooling** cho external requests
5. **Optimize image processing** nếu cần

---

## Security Considerations

1. **Validate all inputs** (đã có Zod schema)
2. **Sanitize URLs** (đã có URL normalization)
3. **Rate limiting** (đã implement)
4. **Request timeout** (đã implement)
5. **Error messages** không leak sensitive info

---

## Contributing

1. Fork repository
2. Create feature branch
3. Make changes
4. Add tests
5. Update documentation
6. Submit pull request

---

## Testing New Features

1. Test với real URLs
2. Test error cases
3. Test edge cases
4. Check performance impact
5. Update documentation

