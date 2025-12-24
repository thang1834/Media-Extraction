# Response Formats

Tài liệu về các loại response từ API.

## Response Types

### 1. Redirect

Direct download URL - client có thể download trực tiếp, không cần xử lý.

**Khi nào:**
- Media URL có thể access trực tiếp
- Không cần processing
- Không cần proxy

**Format:**
```json
{
  "status": "redirect",
  "url": "https://example.com/video.mp4",
  "filename": "video.mp4"
}
```

**Usage:**
```javascript
// Redirect browser hoặc download trực tiếp
window.location.href = data.url;
// hoặc
window.open(data.url, '_blank');
```

---

### 2. Tunnel

Proxy URL qua server với expiration và signature.

**Khi nào:**
- Media URL cần proxy (CORS, authentication, etc.)
- URL có expiration time
- Cần secure access

**Format:**
```json
{
  "status": "tunnel",
  "url": "http://localhost:9000/tunnel?id=abc123&exp=1234567890&sig=xyz&sec=secret&iv=iv",
  "filename": "video.mp4"
}
```

**URL Parameters:**
- `id` - Stream ID (21 characters)
- `exp` - Expiration timestamp (13 digits, milliseconds)
- `sig` - HMAC signature (43 characters)
- `sec` - Encryption secret (43 characters)
- `iv` - Initialization vector (22 characters)

**Usage:**
```javascript
// Download từ tunnel URL
const response = await fetch(data.url);
const blob = await response.blob();
// Save blob to file
```

**Lưu ý:**
- Tunnel URLs có expiration (default: 90 seconds)
- URLs được signed và encrypted
- Không thể reuse sau khi expire

---

### 3. Picker

Multiple media options - user có thể chọn media nào muốn download.

**Khi nào:**
- TikTok user profile (nhiều videos)
- Instagram multi-media post
- Twitter multi-media tweet
- Xiaohongshu multiple images

**Format:**
```json
{
  "status": "picker",
  "picker": [
    {
      "type": "video",
      "url": "http://localhost:9000/tunnel?id=...&exp=...&sig=...",
      "filename": "video1.mp4",
      "thumb": "https://..." // optional
    },
    {
      "type": "video",
      "url": "http://localhost:9000/tunnel?id=...&exp=...&sig=...",
      "filename": "video2.mp4"
    },
    {
      "type": "photo",
      "url": "http://localhost:9000/tunnel?id=...&exp=...&sig=...",
      "filename": "image1.jpg"
    }
  ],
  "audio": "http://localhost:9000/tunnel?id=...", // optional - TikTok audio
  "audioFilename": "audio.mp3" // optional
}
```

**Note:** 
- TikTok picker URLs là tunnel URLs (proxy qua server)
- URLs có expiration time và được signed
- Các services khác (Instagram, Twitter) có thể là direct URLs hoặc tunnel URLs tùy vào service

**Picker Item Types:**
- `video` - Video file
- `photo` - Image file
- `gif` - Animated GIF

**Usage:**
```javascript
if (data.status === 'picker') {
  // Show UI để user chọn
  data.picker.forEach((item, i) => {
    console.log(`${i + 1}. ${item.type}: ${item.filename}`);
  });
  
  // User chọn item
  const selected = data.picker[0];
  downloadFile(selected.url, selected.filename);
}
```

---

### 4. Local Processing

Server-side processing required - server sẽ download và xử lý media.

**Khi nào:**
- Cần merge video + audio
- Cần remux container
- Cần convert format
- Cần extract audio
- Cần mute video

**Format:**
```json
{
  "status": "local-processing",
  "type": "merge",
  "service": "youtube",
  "tunnel": {
    "video": "http://localhost:9000/tunnel?id=...",
    "audio": "http://localhost:9000/tunnel?id=..."
  },
  "output": {
    "type": "video/mp4",
    "filename": "video.mp4",
    "metadata": {
      "title": "Video Title",
      "author": "Author Name"
    },
    "subtitles": true
  },
  "audio": {
    "format": "mp3",
    "bitrate": "128",
    "copy": false,
    "cover": true
  },
  "isHLS": false
}
```

**Processing Types:**
- `merge` - Merge video + audio streams
- `remux` - Remux container format
- `mute` - Remove audio track
- `audio` - Extract audio only
- `gif` - Convert to GIF

**Usage:**
```javascript
if (data.status === 'local-processing') {
  // Download từ tunnel URLs
  // Server sẽ process và stream kết quả
  
  if (data.type === 'merge') {
    // Download merged video
    const videoUrl = data.tunnel.video;
    const audioUrl = data.tunnel.audio;
    // Server sẽ merge và stream
  }
}
```

---

### 5. Error

Error response với error code và context.

**Format:**
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

**Common Error Codes:**
- `error.api.link.missing` - URL parameter missing
- `error.api.link.invalid` - URL invalid
- `error.api.link.unsupported` - URL pattern not supported
- `error.api.service.unsupported` - Service not supported
- `error.api.service.disabled` - Service disabled
- `error.api.fetch.fail` - Failed to fetch media
- `error.api.fetch.rate` - Rate limited by service
- `error.api.fetch.empty` - No media found
- `error.api.content.too_long` - Video exceeds duration limit
- `error.api.rate_exceeded` - Rate limit exceeded
- `error.api.auth.key.missing` - API key missing
- `error.api.auth.key.invalid` - API key invalid
- `error.api.timeout` - Request timeout

Xem [Error Handling](error-handling.md) để biết tất cả error codes.

---

## Response Examples

### YouTube Video

```json
{
  "status": "local-processing",
  "type": "merge",
  "service": "youtube",
  "tunnel": {
    "video": "http://localhost:9000/tunnel?id=...",
    "audio": "http://localhost:9000/tunnel?id=..."
  },
  "output": {
    "type": "video/mp4",
    "filename": "youtube_video.mp4",
    "metadata": {
      "title": "Video Title",
      "author": "Channel Name"
    },
    "subtitles": true
  }
}
```

### TikTok User Profile

```json
{
  "status": "picker",
  "picker": [
    {
      "type": "video",
      "url": "http://localhost:9000/tunnel?id=...",
      "filename": "tiktok_username_123.mp4"
    },
    {
      "type": "video",
      "url": "http://localhost:9000/tunnel?id=...",
      "filename": "tiktok_username_456.mp4"
    }
  ]
}
```

### Audio Only

```json
{
  "status": "local-processing",
  "type": "audio",
  "service": "youtube",
  "tunnel": {
    "audio": "http://localhost:9000/tunnel?id=..."
  },
  "output": {
    "type": "audio/mpeg",
    "filename": "audio.mp3"
  },
  "audio": {
    "format": "mp3",
    "bitrate": "320",
    "cover": true
  }
}
```

---

## Handling Responses

### JavaScript Example

```javascript
async function extractMedia(url) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url })
  });
  
  const data = await response.json();
  
  switch (data.status) {
    case 'redirect':
      // Direct download
      window.location.href = data.url;
      break;
      
    case 'tunnel':
      // Download from tunnel
      downloadFromUrl(data.url, data.filename);
      break;
      
    case 'picker':
      // Show picker UI
      showPicker(data.picker, data.audio);
      break;
      
    case 'local-processing':
      // Process on server
      processMedia(data);
      break;
      
    case 'error':
      // Handle error
      console.error('Error:', data.error.code);
      break;
  }
}
```

### Python Example

```python
import requests

def extract_media(url):
    response = requests.post('http://localhost:9000/', json={'url': url})
    data = response.json()
    
    if data['status'] == 'redirect':
        # Direct download
        download_file(data['url'], data['filename'])
    elif data['status'] == 'tunnel':
        # Download from tunnel
        download_file(data['url'], data['filename'])
    elif data['status'] == 'picker':
        # Show picker
        for item in data['picker']:
            print(f"{item['type']}: {item['filename']}")
    elif data['status'] == 'local-processing':
        # Process on server
        process_media(data)
    elif data['status'] == 'error':
        print(f"Error: {data['error']['code']}")
```

