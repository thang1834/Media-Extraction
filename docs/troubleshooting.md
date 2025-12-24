# Troubleshooting

Giải quyết các vấn đề thường gặp.

## Server Issues

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::9000`

**Solution:**

**Windows:**
```powershell
# Tìm process
Get-NetTCPConnection -LocalPort 9000

# Kill process
Stop-Process -Id <PID> -Force
```

**Linux/Mac:**
```bash
# Tìm process
lsof -i :9000

# Kill process
kill -9 <PID>
```

**Hoặc đổi port:**
```env
API_PORT=9001
```

---

### API_URL Missing

**Error:** `API_URL env variable is missing, api can't start`

**Solution:**
Thêm vào `.env`:
```env
API_URL=http://localhost:9000
```

---

### Configuration Validation Failed

**Error:** `Configuration validation failed`

**Solution:**
- Check error message để biết config nào sai
- Xem [Configuration Guide](configuration.md)
- Đảm bảo tất cả required variables được set

---

## Request Issues

### Request Timeout

**Error:** `error.api.timeout`

**Solution:**
1. Tăng timeout trong `.env`:
   ```env
   REQUEST_TIMEOUT=60000  # 60 seconds
   ```

2. Check network connection
3. Service có thể đang slow

---

### Rate Limit Exceeded

**Error:** `error.api.rate_exceeded`

**Solution:**
1. Đợi một chút rồi thử lại
2. Tăng rate limit trong `.env`:
   ```env
   RATELIMIT_MAX=50
   ```
3. Implement exponential backoff ở client

---

### Invalid Request Body

**Error:** `error.api.invalid_body`

**Solution:**
- Đảm bảo `Content-Type: application/json`
- Check JSON format
- Đảm bảo không có invalid parameters

---

## Service-Specific Issues

### TikTok User Profile Issues

**Problem:** TikTok user profile trả về `error.api.fetch.empty`

**Possible Causes:**
1. Profile là private hoặc không tồn tại
2. TikTok đang block requests (bot detection)
3. Videos được lazy-load và không được fetch kịp

**Solutions:**
1. **Check profile visibility:**
   - Đảm bảo profile là public
   - Thử truy cập profile trong browser trước

2. **Wait longer:**
   - TikTok user profile sử dụng headless browser
   - Có thể mất 20-30 giây để fetch videos
   - Tăng timeout nếu cần:
     ```env
     REQUEST_TIMEOUT=60000  # 60 seconds
     ```

3. **Check logs:**
   - Xem logs để biết có bao nhiêu videos được capture
   - Check xem có error từ Puppeteer không

**Problem:** TikTok picker URLs là empty objects `{}`

**Solution:**
- Đây là bug đã được fix
- Đảm bảo bạn đang dùng version mới nhất
- URLs giờ sẽ là tunnel URLs: `http://localhost:9000/tunnel?id=...`

**Problem:** Headless browser không work

**Possible Causes:**
1. Puppeteer chưa được cài đặt
2. Chromium chưa được download
3. System không support headless browser

**Solutions:**
1. **Install dependencies:**
   ```bash
   npm install puppeteer-extra puppeteer-extra-plugin-stealth
   ```

2. **Check system requirements:**
   - Windows: Cần Windows 10+
   - Linux: Cần các dependencies (xem Puppeteer docs)
   - Mac: Should work out of the box

3. **Check logs:**
   - Xem có error từ Puppeteer không
   - Check xem browser có launch được không

---

## Service-Specific Issues

### YouTube

**Video không tải được:**
- Check video có public không
- Age-restricted videos có thể cần authentication
- Thử với `alwaysProxy: true`

**Audio quality thấp:**
- Set `youtubeBetterAudio: true`
- Use `audioBitrate: "320"`

---

### TikTok

**User profile không trả về videos:**
- TikTok user profile sử dụng headless browser (Puppeteer)
- Có thể mất 20-30 giây để fetch videos
- Check logs để xem có videos được capture không
- Một số profiles có thể cần authentication
- Private profiles không thể access
- Thử với single video URL trước để test

**Headless browser issues:**
- Đảm bảo `puppeteer-extra` và `puppeteer-extra-plugin-stealth` đã được cài đặt
- Check system requirements (Windows 10+, Linux dependencies)
- Xem logs để biết browser có launch được không

**Picker URLs là empty objects:**
- Đây là bug đã được fix
- URLs giờ sẽ là tunnel URLs: `http://localhost:9000/tunnel?id=...`
- Đảm bảo bạn đang dùng version mới nhất

**Video không có audio:**
- Set `tiktokFullAudio: true` để lấy original audio

**TikTok Playlist Download Issues:**

**Problem:** Downloads fail with HTTP 404 or 403 errors

**Possible Causes:**
1. TikTok URLs expire very quickly (especially for playlists)
2. Tunnel URLs expire before downloads complete
3. Rate limiting from TikTok

**Solutions:**
1. **Increase tunnel lifespan:**
   ```env
   TUNNEL_LIFESPAN=600  # 10 minutes (default: 90 seconds)
   ```
   This gives more time for downloads to complete before tunnel URLs expire.

2. **Automatic retry:**
   - System automatically retries failed downloads (404/403) with fresh URLs
   - Extracts `videoId` from filename and fetches new URL from TikTok
   - Retries up to 2 times with exponential backoff

3. **Check download summary:**
   - After auto-download completes, check server logs for download summary
   - Summary shows: total files, success count, failed indices, duration
   - Failed indices are listed for easy identification

4. **Rate limiting:**
   - System adds 1-second delay between batches for TikTok downloads
   - If still getting rate limited, reduce concurrency or add longer delays

**Problem:** Tunnel URLs expire during download (404 errors)

**Solution:**
1. Increase `TUNNEL_LIFESPAN` in `.env`:
   ```env
   TUNNEL_LIFESPAN=600  # 10 minutes
   ```
2. For very large playlists (>100 videos), consider downloading in smaller batches
3. System will automatically retry with fresh URLs if tunnel expires

**Problem:** Playlist name shows incorrect characters (e.g., `vß╗ú c┼⌐` instead of `vợ cũ`)

**Solution:**
- This has been fixed in the latest version
- System now correctly extracts and decodes playlist names from URL
- Supports Unicode characters (Vietnamese, Chinese, etc.)
- Only removes filesystem-invalid characters (`<>:"/\|?*`)

---

### Instagram

**Private account:**
- Chỉ có thể tải từ public accounts
- Stories có expiration time

**Multi-media không hiển thị:**
- Check response có `picker` không
- Đảm bảo handle picker response đúng cách

---

### Twitter/X

**Không reliable:**
- Twitter có thể thay đổi API
- Rate limiting có thể strict
- Thử lại sau một lúc

---

## Network Issues

### CORS Errors

**Error:** CORS policy blocked

**Solution:**
1. Set `CORS_WILDCARD=1` trong `.env`
2. Hoặc set `CORS_URL` với origin cụ thể

---

### Proxy Issues

**Error:** Failed to fetch through proxy

**Solution:**
1. Check proxy URL đúng format:
   ```env
   HTTP_PROXY=http://proxy.example.com:8080
   HTTPS_PROXY=https://proxy.example.com:8080
   ```

2. Test proxy connection
3. Disable proxy nếu không cần

---

## Performance Issues

### Slow Response Times

**Solutions:**
1. Enable Redis cho rate limiting:
   ```env
   API_REDIS_URL=redis://localhost:6379
   ```

2. Tăng `REQUEST_TIMEOUT`
3. Check server resources (CPU, memory)
4. Use multi-instance với Redis:
   ```env
   API_INSTANCE_COUNT=4
   API_REDIS_URL=redis://localhost:6379
   ```

---

### High Memory Usage

**Solutions:**
1. Reduce cache size trong code
2. Enable Redis để offload memory
3. Restart server định kỳ
4. Check for memory leaks trong logs

---

## Logging Issues

### Too Many Logs

**Solution:**
Set log level trong `.env`:
```env
LOG_LEVEL=warn  # Chỉ log warnings và errors
```

---

### Missing Logs

**Solution:**
1. Check `LOG_LEVEL` setting
2. Check log output destination
3. Enable file logging nếu cần

---

## Authentication Issues

### API Key Invalid

**Error:** `error.api.auth.key.invalid`

**Solution:**
1. Check API key format (UUID v4)
2. Verify key trong API key management system
3. Check IP whitelist nếu có

---

### JWT Token Expired

**Error:** `error.api.auth.jwt.invalid`

**Solution:**
1. Get new session token
2. Check `JWT_EXPIRY` setting
3. Tokens expire sau configured lifetime

---

## Development Issues

### Module Not Found

**Error:** `Cannot find package 'express'`

**Solution:**
```bash
npm install
```

---

### Import Errors

**Error:** `Identifier 'logger' has already been declared`

**Solution:**
- Check duplicate imports
- Clear node_modules và reinstall:
  ```bash
  rm -rf node_modules package-lock.json
  npm install
  ```

---

## Health Check Issues

### Health Check Fails

**Check:**
1. Server có đang chạy không
2. Port có đúng không
3. Redis connection (nếu có)

**Test:**
```bash
curl http://localhost:9000/health
```

---

## Getting Help

1. **Check Logs:**
   - Server logs trong console
   - Error messages với request ID

2. **Check Health:**
   ```bash
   curl http://localhost:9000/health?detailed=true
   ```

3. **Check Documentation:**
   - [API Reference](api-reference.md)
   - [Configuration](configuration.md)
   - [Error Handling](error-handling.md)

4. **Common Solutions:**
   - Restart server
   - Clear cache
   - Check environment variables
   - Verify network connectivity

