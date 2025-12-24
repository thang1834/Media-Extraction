import UrlPattern from "url-pattern";

export const audioIgnore = new Set([]);
export const hlsExceptions = new Set(["youtube"]);

export const services = {
    bilibili: {
        patterns: [
            "video/:comId",
            "video/:comId?p=:partId",
            "_shortLink/:comShortLink",
            "_tv/:lang/video/:tvId",
            "_tv/video/:tvId"
        ],
        subdomains: ["m"],
    },
    facebook: {
        patterns: [
            "_shortLink/:shortLink",
            ":username/videos/:caption/:id",
            ":username/videos/:id",
            "reel/:id",
            "share/:shareType/:id"
        ],
        subdomains: ["web", "m"],
        altDomains: ["fb.watch"],
    },
    instagram: {
        patterns: [
            // Most common patterns first
            "p/:postId",  // Most common: instagram.com/p/ABC123
            "reel/:postId",  // Common: instagram.com/reel/ABC123
            "reels/:postId",  // Common variant
            "tv/:postId",  // IGTV
            
            // Share links (test before username patterns)
            /*
                share & username links use the same url pattern,
                so we test the share pattern first, cuz id type is different.
                however, if someone has the "share" username and the user
                somehow gets a link of this ancient style, it's joever.
            */
            "share/:shareId",
            "share/p/:shareId",
            "share/reel/:shareId",

            // Username patterns (less common, more specific)
            ":username/p/:postId",
            ":username/reel/:postId",
            
            // Stories (least common)
            "stories/:username/:storyId",
        ],
        altDomains: ["ddinstagram.com"],
    },
    reddit: {
        patterns: [
            // Most common patterns first
            "r/:sub/comments/:id",  // Most common: reddit.com/r/sub/comments/123
            "r/:sub/comments/:id/:title",  // Common with title
            "comments/:id",  // Direct comments link
            
            // User patterns
            "user/:user/comments/:id",
            "user/:user/comments/:id/:title",
            "r/u_:user/comments/:id",
            "r/u_:user/comments/:id/:title",
            
            // Comment-specific patterns (less common)
            "r/:sub/comments/:id/comment/:commentId",
            "user/:user/comments/:id/comment/:commentId",
            "r/u_:user/comments/:id/comment/:commentId",
            
            // Other patterns
            "r/:sub/s/:shareId",  // Share links
            "video/:shortId",  // Video links
        ],
        subdomains: "*",
    },
    soundcloud: {
        patterns: [
            ":author/:song/s-:accessKey",
            ":author/:song",
            ":shortLink"
        ],
        subdomains: ["on", "m"],
    },
    tiktok: {
        patterns: [
            "@:user/playlist/:playlistName-:playlistId",  // Playlist/Mix: tiktok.com/@user/playlist/name-id (MUST be first, more specific)
            "@:user",  // User profile: tiktok.com/@user (for multiple videos)
            ":user/video/:postId",  // Most common: tiktok.com/@user/video/123
            ":shortLink",  // Common: tiktok.com/ABC123
            "t/:shortLink",  // Common variant
            "i18n/share/video/:postId",  // Share links
            ":user/photo/:postId",  // Photo posts
            "v/:postId.html"  // Less common format
        ],
        subdomains: ["vt", "vm", "m", "t"],
    },
    twitter: {
        patterns: [
            ":user/status/:id",  // Most common: twitter.com/user/status/123
            ":user/status/:id/video/:index",  // Common: video in tweet
            ":user/status/:id/photo/:index",  // Common: photo in tweet
            "i/bookmarks?post_id=:id",  // Bookmarks
            ":user/status/:id/mediaviewer",  // Less common
            ":user/status/:id/mediaViewer"   // Less common (case variant)
        ],
        subdomains: ["mobile"],
        altDomains: ["x.com", "vxtwitter.com", "fixvx.com"],
    },
    xiaohongshu: {
        patterns: [
            "explore/:id?xsec_token=:token",
            "discovery/item/:id?xsec_token=:token",
            ":shareType/:shareId",
        ],
        altDomains: ["xhslink.com"],
    },
    youtube: {
        patterns: [
            "watch?v=:id",  // Most common: youtube.com/watch?v=...
            "v/:id",        // Common: youtube.com/v/...
            "watch/:id",    // Less common: youtube.com/watch/...
            "embed/:id"    // Least common: youtube.com/embed/...
        ],
        subdomains: ["music", "m"],
    }
}

Object.values(services).forEach(service => {
    service.patterns = service.patterns.map(
        pattern => new UrlPattern(pattern, {
            segmentValueCharset: UrlPattern.defaultOptions.segmentValueCharset + '@\\.:'
        })
    )
})
