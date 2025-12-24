# Error Handling

Tài liệu về error codes và cách xử lý errors.

## Error Response Format

Tất cả errors trả về format nhất quán:

```json
{
  "status": "error",
  "error": {
    "code": "error.api.link.invalid",
    "context": {
      "service": "YouTube",
      "requestId": "abc123"
    }
  }
}
```

---

## Error Codes

### Link Errors

| Code | Description | Context |
|------|-------------|---------|
| `error.api.link.missing` | URL parameter is missing | - |
| `error.api.link.invalid` | URL is invalid or malformed | `service` |
| `error.api.link.unsupported` | URL pattern not supported | `service` |
| `error.api.link.too_long` | URL exceeds maximum length (2048 chars) | `maxLength` |

### Service Errors

| Code | Description | Context |
|------|-------------|---------|
| `error.api.service.unsupported` | Service not supported | - |
| `error.api.service.disabled` | Service is disabled | - |
| `error.api.service.audio_not_supported` | Audio extraction not supported | - |

### Fetch Errors

| Code | Description | Context |
|------|-------------|---------|
| `error.api.fetch.fail` | Failed to fetch media | `service` |
| `error.api.fetch.rate` | Rate limited by service | `service` |
| `error.api.fetch.critical` | Critical fetch error | `service` |
| `error.api.fetch.empty` | No media found | `service` |
| `error.api.fetch.short_link` | Failed to resolve short link | - |

### Content Errors

| Code | Description | Context |
|------|-------------|---------|
| `error.api.content.too_long` | Video exceeds duration limit | `limit` (minutes) |
| `error.api.content.video.unavailable` | Video is unavailable | `service` |
| `error.api.content.video.private` | Video is private | `service` |
| `error.api.content.post.private` | Post is private | `service` |
| `error.api.content.post.age` | Age-restricted content | `service` |
| `error.api.content.post.unavailable` | Post is unavailable | `service` |

### Authentication Errors

| Code | Description | Context |
|------|-------------|---------|
| `error.api.auth.key.missing` | API key missing | - |
| `error.api.auth.key.invalid` | API key invalid | - |
| `error.api.auth.key.not_found` | API key not found | - |
| `error.api.auth.key.ip_not_allowed` | IP not allowed for this key | - |
| `error.api.auth.key.ua_not_allowed` | User-Agent not allowed | - |
| `error.api.auth.jwt.missing` | JWT token missing | - |
| `error.api.auth.jwt.invalid` | JWT token invalid | - |

### Request Errors

| Code | Description | Context |
|------|-------------|---------|
| `error.api.invalid_body` | Request body invalid | - |
| `error.api.header.accept` | Invalid Accept header | - |
| `error.api.header.content_type` | Invalid Content-Type header | - |
| `error.api.timeout` | Request timeout | `timeout` (seconds) |

### Rate Limiting

| Code | Description | Context |
|------|-------------|---------|
| `error.api.rate_exceeded` | Rate limit exceeded | `limit` (window in seconds) |

### Generic Errors

| Code | Description | Context |
|------|-------------|---------|
| `error.api.generic` | Generic error | - |

---

## Error Context

Một số errors bao gồm context để debug tốt hơn:

```json
{
  "status": "error",
  "error": {
    "code": "error.api.content.too_long",
    "context": {
      "limit": 180.0,  // minutes
      "requestId": "abc123"
    }
  }
}
```

---

## Handling Errors

### JavaScript Example

```javascript
async function extractMedia(url) {
  try {
    const response = await fetch('http://localhost:9000/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    });
    
    const data = await response.json();
    
    if (data.status === 'error') {
      handleError(data.error);
      return;
    }
    
    // Handle success...
    
  } catch (error) {
    console.error('Network error:', error);
  }
}

function handleError(error) {
  const { code, context } = error;
  
  switch (code) {
    case 'error.api.link.invalid':
      alert('Invalid URL. Please check the URL format.');
      break;
      
    case 'error.api.link.unsupported':
      alert(`URL pattern not supported for ${context.service}`);
      break;
      
    case 'error.api.fetch.fail':
      alert(`Failed to fetch from ${context.service}. The content may be unavailable.`);
      break;
      
    case 'error.api.fetch.rate':
      alert(`Rate limited by ${context.service}. Please try again later.`);
      break;
      
    case 'error.api.content.too_long':
      alert(`Video exceeds maximum duration (${context.limit} minutes)`);
      break;
      
    case 'error.api.content.video.private':
      alert('This video is private and cannot be downloaded.');
      break;
      
    case 'error.api.rate_exceeded':
      alert(`Rate limit exceeded. Limit: ${context.limit} seconds`);
      break;
      
    case 'error.api.timeout':
      alert(`Request timeout (${context.timeout} seconds)`);
      break;
      
    default:
      console.error('Error:', code, context);
      alert('An error occurred. Please try again.');
  }
}
```

### Python Example

```python
import requests

def extract_media(url):
    try:
        response = requests.post(
            'http://localhost:9000/',
            json={'url': url},
            timeout=30
        )
        
        data = response.json()
        
        if data['status'] == 'error':
            handle_error(data['error'])
            return
        
        # Handle success...
        
    except requests.exceptions.Timeout:
        print('Request timeout')
    except requests.exceptions.RequestException as e:
        print(f'Network error: {e}')

def handle_error(error):
    code = error['code']
    context = error.get('context', {})
    
    error_messages = {
        'error.api.link.invalid': 'Invalid URL',
        'error.api.link.unsupported': f"URL pattern not supported for {context.get('service', 'unknown')}",
        'error.api.fetch.fail': f"Failed to fetch from {context.get('service', 'unknown')}",
        'error.api.content.too_long': f"Video exceeds maximum duration ({context.get('limit', 'unknown')} minutes)",
        'error.api.rate_exceeded': f"Rate limit exceeded",
    }
    
    message = error_messages.get(code, f"Error: {code}")
    print(message)
```

---

## Retry Logic

### Exponential Backoff

```javascript
async function extractMediaWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('http://localhost:9000/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url })
      });
      
      const data = await response.json();
      
      if (data.status === 'error') {
        const errorCode = data.error.code;
        
        // Don't retry on these errors
        const noRetryErrors = [
          'error.api.link.invalid',
          'error.api.link.unsupported',
          'error.api.content.video.private',
          'error.api.content.too_long'
        ];
        
        if (noRetryErrors.includes(errorCode)) {
          throw new Error(errorCode);
        }
        
        // Retry on transient errors
        if (i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      return data;
      
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      
      const delay = Math.pow(2, i) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

## Error Logging

### Log Errors với Context

```javascript
function logError(error, requestId) {
  const { code, context } = error;
  
  console.error({
    errorCode: code,
    context,
    requestId,
    timestamp: new Date().toISOString()
  });
  
  // Send to error tracking service
  if (window.Sentry) {
    window.Sentry.captureException(new Error(code), {
      extra: { context, requestId }
    });
  }
}
```

---

## Common Error Scenarios

### 1. Invalid URL

**Error:** `error.api.link.invalid`

**Solution:**
- Kiểm tra URL format
- Đảm bảo URL là public và accessible
- Thử với URL đầy đủ (không phải short link)

### 2. Rate Limited

**Error:** `error.api.rate_exceeded`

**Solution:**
- Đợi một chút rồi thử lại
- Giảm số requests
- Implement exponential backoff

### 3. Video Too Long

**Error:** `error.api.content.too_long`

**Solution:**
- Tăng `DURATION_LIMIT` trong `.env`
- Hoặc chọn video ngắn hơn

### 4. Private Content

**Error:** `error.api.content.video.private`

**Solution:**
- Chỉ có thể tải public content
- Private videos không thể access

### 5. Service Unavailable

**Error:** `error.api.fetch.fail`

**Solution:**
- Service có thể đang down
- Thử lại sau
- Check health endpoint

---

## Error Prevention

1. **Validate URLs trước khi gửi:**
   ```javascript
   function isValidUrl(url) {
     try {
       new URL(url);
       return true;
     } catch {
       return false;
     }
   }
   ```

2. **Check health trước khi dùng:**
   ```javascript
   async function checkHealth() {
     const response = await fetch('http://localhost:9000/health');
     const health = await response.json();
     return health.status === 'healthy';
   }
   ```

3. **Implement rate limiting ở client:**
   ```javascript
   let lastRequest = 0;
   const MIN_INTERVAL = 1000; // 1 second
   
   async function throttledRequest(url) {
     const now = Date.now();
     if (now - lastRequest < MIN_INTERVAL) {
       await new Promise(resolve => 
         setTimeout(resolve, MIN_INTERVAL - (now - lastRequest))
       );
     }
     lastRequest = Date.now();
     return fetch(url);
   }
   ```

