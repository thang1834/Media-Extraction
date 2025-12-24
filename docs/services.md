# Supported Services

Chi tiết về các services được hỗ trợ và tính năng của từng service.

## Service Comparison

| Service | Video+Audio | Audio Only | Video Only | Metadata | Rich Filenames | Multi-Media |
|---------|:-----------:|:----------:|:----------:|:--------:|:--------------:|:-----------:|
| bilibili | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| facebook | ✅ | ❌ | ✅ | ➖ | ➖ | ➖ |
| instagram | ✅ | ✅ | ✅ | ➖ | ➖ | ✅ |
| reddit | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ |
| soundcloud | ➖ | ✅ | ➖ | ✅ | ✅ | ➖ |
| tiktok | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ 🆕 |
| twitter/x | ✅ | ✅ | ✅ | ➖ | ➖ | ✅ |
| xiaohongshu | ✅ | ✅ | ✅ | ➖ | ➖ | ✅ |
| youtube | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |

---

## YouTube

**URL Formats:**
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/v/VIDEO_ID`

**Features:**
- ✅ Videos, Shorts, Music
- ✅ 8K, 4K, HDR, VR, High FPS
- ✅ Rich metadata (title, author, description, etc.)
- ✅ Subtitles support
- ✅ Dubs support
- ✅ Multiple codecs: h264, av1, vp9
- ✅ Multiple containers: mp4, webm, mkv

**Special Parameters:**
```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "youtubeVideoCodec": "av1",
  "youtubeVideoContainer": "webm",
  "subtitleLang": "vi",
  "youtubeDubLang": "vi",
  "youtubeBetterAudio": true
}
```

**Limitations:**
- Private videos không thể tải
- Age-restricted videos có thể cần authentication

---

## TikTok

**URL Formats:**
- `https://www.tiktok.com/@user/video/VIDEO_ID` - Single video
- `https://www.tiktok.com/@user` - User profile (multiple videos) 🆕
- `https://www.tiktok.com/@user/playlist/PLAYLIST_NAME-PLAYLIST_ID` - Playlist/Mix 🆕
- `https://vt.tiktok.com/SHORT_LINK` - Short link

**Features:**
- ✅ Videos với/không watermark
- ✅ Images từ slideshow
- ✅ Full audio (original music)
- ✅ **User profile support** 🆕 - Tải nhiều videos từ user
- ✅ **Playlist/Mix support** 🆕 - Tải tất cả videos từ playlist

**Special Parameters:**
```json
{
  "url": "https://www.tiktok.com/@username",
  "videoQuality": "max",
  "tiktokFullAudio": true
}
```

**User Profile với Auto-Download:**
```json
{
  "url": "https://www.tiktok.com/@username",
  "autoDownload": true
}
```

Returns picker với danh sách videos (tối đa 50 videos đầu tiên).

**Playlist/Mix với Auto-Download:**
```json
{
  "url": "https://www.tiktok.com/@username/playlist/playlist-name-1234567890",
  "videoQuality": "max",
  "downloadMode": "auto"
}
```

Hoặc với URL có ký tự đặc biệt (tiếng Việt):
```json
{
  "url": "https://www.tiktok.com/@dmst2023/playlist/t%C3%A2m%20t%C3%A2m-7421822737142467346",
  "videoQuality": "max",
  "downloadMode": "auto"
}
```

Returns picker với tất cả videos trong playlist (không giới hạn số lượng).

Khi `autoDownload: true` hoặc `downloadMode: "auto"`, files sẽ tự động được download vào:
- **User profile:** `downloads/tiktok/username/`
- **Playlist:** `downloads/tiktok/username/playlistName/`

Playlist name được giữ nguyên (hỗ trợ Unicode, tiếng Việt) và chỉ loại bỏ các ký tự không hợp lệ cho filesystem.

**Technical Details:**
- Sử dụng headless browser (Puppeteer) với stealth plugin để tránh bot detection
- Intercept API responses (`/api/mix/item_list/`, `/api/playlist/item_list/`) để lấy video data trực tiếp
- Tự động scroll vào video list container để trigger lazy-loading và load tất cả videos
- Tất cả video URLs được proxy qua tunnel (secure, signed URLs)
- Hỗ trợ playlist với tên tiếng Việt và ký tự đặc biệt
- **Retry logic:** Tự động retry với fresh URL khi gặp 404/403 errors (extract từ `videoId`)
- **Rate limiting:** Delay 1 giây giữa các batches để tránh rate limiting
- **Tunnel lifespan:** Khuyến nghị set `TUNNEL_LIFESPAN=600` (10 phút) trong `.env` để tránh tunnel expiration khi download playlist lớn

**Limitations:**
- User profile: Tối đa 50 videos đầu tiên
- Playlist: Không giới hạn (lấy tất cả videos trong playlist)
- Một số profiles có thể cần authentication
- Private videos không thể tải
- Có thể mất thời gian lâu hơn do sử dụng headless browser (đặc biệt với playlist lớn)

---

## Instagram

**URL Formats:**
- `https://www.instagram.com/p/POST_ID`
- `https://www.instagram.com/reel/REEL_ID`
- `https://www.instagram.com/tv/IGTV_ID`

**Features:**
- ✅ Reels, Photos, Videos
- ✅ Multi-media picker (chọn media từ post)
- ✅ Stories support

**Special Parameters:**
```json
{
  "url": "https://www.instagram.com/p/ABC123",
  "videoQuality": "1080",
  "alwaysProxy": true
}
```

**Multi-Media Post:**
Returns picker với tất cả media items trong post.

**Limitations:**
- Private accounts không thể access
- Stories có expiration time

---

## Twitter/X

**URL Formats:**
- `https://twitter.com/user/status/TWEET_ID`
- `https://x.com/user/status/TWEET_ID`
- `https://vxtwitter.com/user/status/TWEET_ID`

**Features:**
- ✅ Videos, Images
- ✅ Multi-media picker
- ✅ GIF conversion support

**Special Parameters:**
```json
{
  "url": "https://twitter.com/user/status/123",
  "convertGif": true,
  "alwaysProxy": true
}
```

**Limitations:**
- ⚠️ Có thể không 100% reliable do Twitter management
- Rate limiting có thể strict
- Private tweets không thể access

---

## Reddit

**URL Formats:**
- `https://www.reddit.com/r/sub/comments/POST_ID`
- `https://redd.it/SHORT_ID`

**Features:**
- ✅ GIFs và Videos
- ✅ Audio extraction support

**Limitations:**
- ❌ Metadata không hỗ trợ
- ❌ Rich filenames không hỗ trợ
- Private subreddits không thể access

---

## Facebook

**URL Formats:**
- `https://www.facebook.com/user/videos/VIDEO_ID`
- `https://fb.watch/VIDEO_ID`

**Features:**
- ✅ Public videos only

**Limitations:**
- ❌ Audio extraction không hỗ trợ
- Private videos không thể access
- Cần public video

---

## SoundCloud

**URL Formats:**
- `https://soundcloud.com/artist/track`
- `https://on.soundcloud.com/SHORT_LINK`

**Features:**
- ✅ Audio only
- ✅ Private links support
- ✅ Rich metadata
- ✅ Rich filenames

**Special Parameters:**
```json
{
  "url": "https://soundcloud.com/artist/track",
  "audioFormat": "mp3",
  "audioBitrate": "320"
}
```

**Limitations:**
- Chỉ audio, không có video
- Một số tracks có thể cần authentication

---

## Bilibili

**URL Formats:**
- `https://www.bilibili.com/video/BV_ID`
- `https://b23.tv/SHORT_LINK`

**Features:**
- ✅ Videos và Audio
- ✅ Multiple parts support

**Limitations:**
- Metadata không hỗ trợ
- Rich filenames không hỗ trợ

---

## Xiaohongshu (Little Red Book)

**URL Formats:**
- `https://www.xiaohongshu.com/explore/NOTE_ID?xsec_token=TOKEN`
- `https://xhslink.com/SHARE_ID`

**Features:**
- ✅ Videos và Images
- ✅ Multi-image picker

**Limitations:**
- Cần token cho một số URLs
- Private notes không thể access

---

## Service-Specific Notes

### TikTok User Profile 🆕

**Cách sử dụng:**
```json
{
  "url": "https://www.tiktok.com/@username"
}
```

**Response:**
- Returns `picker` với danh sách videos
- Tối đa 50 videos đầu tiên
- Mỗi video có tunnel URL (proxy qua server) để download

**Technical Implementation:**
- Sử dụng Puppeteer với stealth plugin để tránh bot detection
- Network interception để bắt API responses (`/api/post/item_list/`)
- Tự động scroll để trigger lazy-loading và load thêm videos
- Fallback extraction từ HTML nếu API interception không thành công

**Lưu ý:**
- Tất cả video URLs là tunnel URLs (có expiration, signed)
- Có thể mất 20-30 giây để fetch và process
- Một số profiles có thể cần authentication
- Private profiles không thể access

### Instagram Multi-Media

Instagram posts có thể chứa nhiều media items. API sẽ trả về picker để user chọn.

### Twitter Multi-Media

Twitter tweets có thể chứa nhiều videos/images. API sẽ trả về picker.

---

## Adding New Services

Xem [Development Guide](development.md#adding-a-new-service) để biết cách thêm service mới.

