export const testers = {
    "bilibili": pattern =>
        (pattern.comId?.length <= 12 && pattern.partId?.length <= 3) ||
        (pattern.comId?.length <= 12 && !pattern.partId) ||
        pattern.comShortLink?.length <= 16 ||
        pattern.tvId?.length <= 24,

    "facebook": pattern =>
        pattern.shortLink?.length <= 11 ||
        pattern.username?.length <= 30 ||
        pattern.caption?.length <= 255 ||
        pattern.id?.length <= 20 && !pattern.shareType ||
        pattern.id?.length <= 20 && pattern.shareType?.length === 1,

    "instagram": pattern =>
        pattern.postId?.length <= 48 ||
        pattern.shareId?.length <= 16 ||
        (pattern.username?.length <= 30 && pattern.storyId?.length <= 24),

    "reddit": pattern =>
        pattern.id?.length <= 16 && !pattern.sub && !pattern.user ||
        (pattern.sub?.length <= 22 && pattern.id?.length <= 16) ||
        (pattern.user?.length <= 22 && pattern.id?.length <= 16) ||
        (pattern.sub?.length <= 22 && pattern.shareId?.length <= 16) ||
        (pattern.shortId?.length <= 16),

    "soundcloud": pattern =>
        (pattern.author?.length <= 255 && pattern.song?.length <= 255) ||
        pattern.shortLink?.length <= 32,

    "tiktok": pattern =>
        pattern.postId?.length <= 21 ||
        pattern.shortLink?.length <= 21 ||
        (pattern.user && pattern.user.length <= 30 && !pattern.postId) || // User profile (no postId)
        (pattern.user && pattern.user.length <= 30 && pattern.playlistId && pattern.playlistId.length <= 20), // Playlist/Mix

    "twitter": pattern =>
        pattern.id?.length < 20,

    "xiaohongshu": pattern =>
        pattern.id?.length <= 24 && pattern.token?.length <= 64 ||
        pattern.shareId?.length <= 24 && pattern.shareType?.length === 1,

    "youtube": pattern =>
        pattern.id?.length <= 11,
}
