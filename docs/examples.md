# Examples

Code examples cho các use cases phổ biến.

## Basic Usage

### cURL

#### Download YouTube Video

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "videoQuality": "1080"
  }'
```

#### Download TikTok User Profile Videos

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.tiktok.com/@username",
    "videoQuality": "max"
  }'
```

#### Download TikTok Playlist/Mix

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.tiktok.com/@username/playlist/playlist-name-1234567890",
    "videoQuality": "max",
    "downloadMode": "auto"
  }'
```

#### Auto-Download to Server

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.tiktok.com/@username",
    "videoQuality": "max",
    "autoDownload": true
  }'
```

Files will be automatically downloaded to:
- **User profile:** `downloads/tiktok/username/`
- **Playlist:** `downloads/tiktok/username/playlistName/`

**Note:** For large playlists, set `TUNNEL_LIFESPAN=600` in `.env` to prevent tunnel URLs from expiring during download.

#### Extract Audio Only

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=...",
    "downloadMode": "audio",
    "audioFormat": "mp3",
    "audioBitrate": "320"
  }'
```

---

## JavaScript/Node.js

### Basic Example

```javascript
async function downloadMedia(url) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      videoQuality: '1080'
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'error') {
    console.error('Error:', data.error.code);
    return;
  }
  
  // Handle different response types
  if (data.status === 'tunnel' || data.status === 'redirect') {
    // Download file
    const fileResponse = await fetch(data.url);
    const blob = await fileResponse.blob();
    
    // Save to file
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data.filename;
    a.click();
  } else if (data.status === 'picker') {
    // Show picker UI
    console.log('Found', data.picker.length, 'items');
    data.picker.forEach((item, i) => {
      console.log(`${i + 1}. ${item.type}: ${item.filename}`);
      console.log(`   URL: ${item.url}`);
    });
    
    // Download first video (or let user choose)
    if (data.picker.length > 0) {
      const selected = data.picker[0];
      const fileResponse = await fetch(selected.url);
      const blob = await fileResponse.blob();
      
      // Save to file
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = selected.filename;
      a.click();
    }
  }
}
```

### TikTok User Profile Example

```javascript
async function downloadTikTokProfile(username) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: `https://www.tiktok.com/@${username}`,
      videoQuality: 'max'
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'picker') {
    console.log(`Found ${data.picker.length} videos from @${username}`);
    
    // Note: TikTok picker URLs are tunnel URLs (proxy through server)
    // They have expiration time and are signed for security
    
    // Download all videos
    for (const video of data.picker) {
      if (video.type === 'video') {
        // video.url is a tunnel URL like: http://localhost:9000/tunnel?id=...&exp=...&sig=...
        await downloadFile(video.url, video.filename);
      }
    }
  }
}
```

### TikTok Playlist/Mix Example

```javascript
async function downloadTikTokPlaylist(playlistUrl) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: playlistUrl, // e.g., "https://www.tiktok.com/@username/playlist/playlist-name-1234567890"
      videoQuality: 'max',
      downloadMode: 'auto' // or use autoDownload: true (both work the same)
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'picker') {
    console.log(`Found ${data.picker.length} videos in playlist`);
    console.log('Videos are being downloaded automatically to server...');
    // Files are downloaded to downloads/tiktok/username/playlistName/ folder
    // Check server logs for download progress and summary
  }
}
```

### Auto-Download Example

```javascript
async function autoDownloadTikTokProfile(username) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: `https://www.tiktok.com/@${username}`,
      videoQuality: 'max',
      autoDownload: true // Enable auto-download
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'picker') {
    console.log(`Found ${data.picker.length} videos from @${username}`);
    console.log('Files are being downloaded to server automatically...');
    console.log('Location: downloads/tiktok/' + username + '/');
    
    // Files are downloaded in the background
    // Check server logs for download progress
  }
}

async function downloadFile(url, filename) {
  const response = await fetch(url);
  const blob = await response.blob();
  
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
```

### Error Handling

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
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'error') {
      const errorCode = data.error.code;
      const context = data.error.context;
      
      switch (errorCode) {
        case 'error.api.link.invalid':
          console.error('Invalid URL');
          break;
        case 'error.api.rate_exceeded':
          console.error('Rate limit exceeded. Try again later.');
          break;
        case 'error.api.fetch.fail':
          console.error(`Failed to fetch from ${context.service}`);
          break;
        default:
          console.error('Error:', errorCode);
      }
      return;
    }
    
    // Handle success...
    
  } catch (error) {
    console.error('Network error:', error);
  }
}
```

---

## Python

### Basic Example

```python
import requests

def download_media(url):
    response = requests.post(
        'http://localhost:9000/',
        json={
            'url': url,
            'videoQuality': '1080'
        }
    )
    
    data = response.json()
    
    if data['status'] == 'error':
        print(f"Error: {data['error']['code']}")
        return
    
    if data['status'] in ['tunnel', 'redirect']:
        # Download file
        file_response = requests.get(data['url'], stream=True)
        with open(data['filename'], 'wb') as f:
            for chunk in file_response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"Downloaded: {data['filename']}")
    
    elif data['status'] == 'picker':
        print(f"Found {len(data['picker'])} items")
        for i, item in enumerate(data['picker']):
            print(f"{i + 1}. {item['type']}: {item['filename']}")
```

### TikTok User Profile

```python
import requests

def download_tiktok_profile(username):
    response = requests.post(
        'http://localhost:9000/',
        json={
            'url': f'https://www.tiktok.com/@{username}',
            'videoQuality': 'max'
        }
    )
    
    data = response.json()
    
    if data['status'] == 'picker':
        print(f"Found {len(data['picker'])} videos from @{username}")
        
        for video in data['picker']:
            if video['type'] == 'video':
                download_file(video['url'], video['filename'])

def download_file(url, filename):
    response = requests.get(url, stream=True)
    with open(filename, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"Downloaded: {filename}")
```

---

## React Example

```jsx
import { useState } from 'react';

function MediaDownloader() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  
  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('http://localhost:9000/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          videoQuality: '1080'
        })
      });
      
      const data = await response.json();
      
      if (data.status === 'error') {
        setError(data.error.code);
        return;
      }
      
      setResult(data);
      
      // Auto download if redirect or tunnel
      if (data.status === 'redirect' || data.status === 'tunnel') {
        window.open(data.url, '_blank');
      }
      
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Enter media URL"
      />
      <button onClick={handleDownload} disabled={loading}>
        {loading ? 'Loading...' : 'Download'}
      </button>
      
      {error && <div>Error: {error}</div>}
      
      {result?.status === 'picker' && (
        <div>
          <h3>Select media:</h3>
          {result.picker.map((item, i) => (
            <div key={i}>
              <a href={item.url} download={item.filename}>
                {item.filename}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Advanced Examples

### Batch Download từ TikTok Profile

```javascript
async function batchDownloadTikTokProfile(username, maxVideos = 10) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: `https://www.tiktok.com/@${username}`,
      videoQuality: 'max'
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'picker') {
    const videos = data.picker
      .filter(item => item.type === 'video')
      .slice(0, maxVideos);
    
    console.log(`Downloading ${videos.length} videos...`);
    
    // Download với concurrency limit
    const concurrency = 3;
    for (let i = 0; i < videos.length; i += concurrency) {
      const batch = videos.slice(i, i + concurrency);
      await Promise.all(
        batch.map(video => downloadFile(video.url, video.filename))
      );
    }
  }
}
```

### Auto-Download với Server Storage

```javascript
async function autoDownloadWithServerStorage(username) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: `https://www.tiktok.com/@${username}`,
      videoQuality: 'max',
      autoDownload: true // Server will download automatically
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'picker') {
    console.log(`Found ${data.picker.length} videos`);
    console.log('Server is downloading files to: downloads/tiktok/' + username + '/');
    
    // Files are downloaded automatically in the background
    // No need to manually download from client
  }
}
```

### Audio Extraction với Metadata

```javascript
async function extractAudioWithMetadata(url) {
  const response = await fetch('http://localhost:9000/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      downloadMode: 'audio',
      audioFormat: 'mp3',
      audioBitrate: '320',
      disableMetadata: false // Keep metadata
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'local-processing') {
    console.log('Processing audio with metadata...');
    console.log('Metadata:', data.output.metadata);
    
    // Download processed audio
    const audioUrl = data.tunnel.audio;
    await downloadFile(audioUrl, data.output.filename);
  }
}
```

### Health Check Monitoring

```javascript
async function checkServerHealth() {
  const response = await fetch('http://localhost:9000/health?detailed=true');
  const health = await response.json();
  
  console.log('Server Status:', health.status);
  console.log('Uptime:', health.uptime.formatted);
  console.log('Memory Usage:', health.memory);
  
  if (health.status !== 'healthy') {
    console.warn('Server is not healthy!');
  }
  
  return health.status === 'healthy';
}
```

---

## Service-Specific Examples

### YouTube với Subtitles

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "videoQuality": "1080",
  "subtitleLang": "vi"
}
```

### YouTube với Dub

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "youtubeDubLang": "vi"
}
```

### TikTok Full Audio

```json
{
  "url": "https://www.tiktok.com/@user/video/123",
  "tiktokFullAudio": true
}
```

### Instagram Multi-Media

```json
{
  "url": "https://www.instagram.com/p/ABC123",
  "videoQuality": "1080"
}
```

Returns picker với tất cả media items.

