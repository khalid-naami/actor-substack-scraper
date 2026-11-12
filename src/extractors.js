/**
 * Substack Ultimate Scraper - Extractors & Parsers
 * High-speed parsing for Publications, Full Articles, Comments, Search Items, and Leads.
 */

export function sanitizeRecord(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') {
        return Number.isNaN(value) || !Number.isFinite(value) ? undefined : value;
    }
    if (Array.isArray(value)) {
        const cleaned = [];
        for (const item of value) {
            const next = sanitizeRecord(item);
            if (next !== undefined) cleaned.push(next);
        }
        return cleaned;
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const next = sanitizeRecord(v);
            if (next !== undefined) out[k] = next;
        }
        return out;
    }
    return value;
}

export function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, (_, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _;
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _;
        })
        .replace(/&amp;/gi, '&');
}

export function parseSafeInt(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

export function normalizeSubstackUrl(rawInput) {
    let candidate = '';
    if (typeof rawInput === 'string') {
        candidate = rawInput.trim();
    } else if (rawInput && typeof rawInput === 'object' && typeof rawInput.url === 'string') {
        candidate = rawInput.url.trim();
    }
    if (!candidate) return null;

    if (/^@[a-zA-Z0-9_.-]+$/.test(candidate)) {
        return `https://substack.com/${candidate}`;
    }
    if (!/^https?:\/\//i.test(candidate)) {
        if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(candidate)) {
            candidate = `https://${candidate}`;
        } else if (/^[a-zA-Z0-9-]+$/.test(candidate)) {
            candidate = `https://${candidate}.substack.com`;
        } else {
            return null;
        }
    }

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        parsed.protocol = 'https:';
        return parsed.toString();
    } catch (_) {
        return null;
    }
}

export function detectSubstackTargetType(url, explicitMode = 'AUTO_DETECT') {
    if (explicitMode && explicitMode !== 'AUTO_DETECT') return explicitMode;
    const lower = String(url || '').toLowerCase();
    if (lower.includes('/p/')) return 'POSTS';
    if (lower.includes('substack.com/search') || /[?&](q|query)=/.test(lower)) return 'SEARCH';
    return 'PUBLICATIONS';
}

export function extractSearchQueryFromUrl(url) {
    try {
        const parsed = new URL(url);
        return (parsed.searchParams.get('query') || parsed.searchParams.get('q') || '').trim();
    } catch (_) {
        return '';
    }
}

// Helper to extract email addresses
export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['substack.com', 'mg2.substack.com', 'substack-custom-domains.com', 'example.com'];
    const unique = [...new Set(matches.map((m) => m.trim().toLowerCase()))];
    return unique.filter((e) => !ignored.some((d) => e === d || e.endsWith(`@${d}`)));
}

// Helper to extract phone numbers
export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map((p) => p.trim())
        .filter((p) => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

// Helper to extract social profile links
export function extractSocialLinks(text) {
    if (!text || typeof text !== 'string') return [];
    const regex = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|linkedin\.com|youtube\.com|github\.com|instagram\.com|threads\.com|threads\.net)\/[a-zA-Z0-9_@./-]+/gi;
    const matches = text.match(regex) || [];
    return [...new Set(matches.map((u) => u.replace(/[),.;]+$/, '')))];
}

// Convert HTML to clean plain text for AI & LLMs
export function htmlToPlainText(html) {
    if (!html || typeof html !== 'string') return '';
    const stripped = html
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '');

    return decodeHtmlEntities(stripped)
        .replace(/\r\n/g, '\n')
        .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
        .trim();
}

// Extract window._preloads / <script id="preloads-json"> from Substack HTML
export function extractPreloadsFromHtml(html) {
    if (!html || typeof html !== 'string') return null;

    const scriptMatch = html.match(/<script[^>]+id=["']preloads-json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch?.[1]) {
        try {
            return JSON.parse(scriptMatch[1]);
        } catch (_) {}
    }

    const inlineMatch = html.match(/window\._preloads\s*=\s*JSON\.parse\(("(?:\\.|[^"\\])*")\)/);
    if (inlineMatch?.[1]) {
        try {
            return JSON.parse(JSON.parse(inlineMatch[1]));
        } catch (_) {}
    }

    return null;
}

// Parse Publication Metadata (from preloads.pub, API, or search publication obj)
export function parsePublicationMeta(pubObj, origin) {
    if (!pubObj || typeof pubObj !== 'object') return null;

    const name = String(pubObj.name || pubObj.publicationName || '').trim();
    const subdomain = String(pubObj.subdomain || '').trim();
    if (!name && !subdomain) return null;

    const description = htmlToPlainText(pubObj.hero_text || pubObj.author_bio || '') || String(pubObj.hero_text || pubObj.author_bio || '').trim();
    const logoUrl = pubObj.logo_url || pubObj.logo_url_wide || undefined;
    const coverUrl = pubObj.cover_photo_url || pubObj.cover_image_url || pubObj.hero_image || undefined;
    const primaryAuthor = pubObj.author_name || pubObj.email_from_name || undefined;
    const resolvedUrl = pubObj.custom_domain
        ? `https://${pubObj.custom_domain.replace(/^https?:\/\//i, '')}`
        : (subdomain ? `https://${subdomain}.substack.com` : origin);

    const combined = `${name} ${description} ${pubObj.support_email || ''}`;
    const emails = extractEmails(combined);
    const phones = extractPhones(combined);
    const socialLinks = extractSocialLinks(combined);

    return sanitizeRecord({
        type: 'PUBLICATION',
        id: String(pubObj.id || subdomain || resolvedUrl),
        url: origin || resolvedUrl,
        title: name || subdomain,
        publicationName: name || subdomain,
        publicationSubdomain: subdomain || undefined,
        publicationUrl: origin || resolvedUrl,
        description: description || undefined,
        publicationLogoUrl: logoUrl,
        coverImageUrl: coverUrl,
        primaryAuthor,
        subscriberHint: pubObj.rankingDetail || undefined,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        socialLinks: socialLinks.length > 0 ? socialLinks : undefined,
        scrapedAt: new Date().toISOString()
    });
}

// Fallback Publication + Post parser from Substack /feed RSS XML
export function parseRssFeed(xml, origin) {
    if (!xml || typeof xml !== 'string' || !xml.includes('<rss')) {
        return { publication: null, posts: [] };
    }

    const extractTag = (block, tag) => {
        const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`, 'i');
        const m = block.match(re);
        return decodeHtmlEntities((m ? (m[1] ?? m[2] ?? '') : '').trim());
    };

    const channelHeader = xml.split(/<item[\s>]/i)[0] || xml;
    const title = extractTag(channelHeader, 'title');
    const description = htmlToPlainText(extractTag(channelHeader, 'description'));
    const imageBlock = channelHeader.match(/<image>[\s\S]*?<\/image>/i)?.[0] || '';
    const logoUrl = extractTag(imageBlock, 'url') || undefined;

    const publication = title
        ? sanitizeRecord({
            type: 'PUBLICATION',
            id: origin,
            url: origin,
            title,
            publicationName: title,
            publicationUrl: origin,
            description: description || undefined,
            publicationLogoUrl: logoUrl,
            scrapedAt: new Date().toISOString()
        })
        : null;

    const posts = [];
    const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const itemXml of itemMatches) {
        const itemTitle = extractTag(itemXml, 'title');
        const link = extractTag(itemXml, 'link');
        const guid = extractTag(itemXml, 'guid') || link;
        const creator = extractTag(itemXml, 'dc:creator') || undefined;
        const pubDate = extractTag(itemXml, 'pubDate');
        const desc = htmlToPlainText(extractTag(itemXml, 'description'));
        const contentHtml = extractTag(itemXml, 'content:encoded');
        const bodyText = htmlToPlainText(contentHtml) || desc;
        const slug = link.match(/\/p\/([a-zA-Z0-9_-]+)/)?.[1] || undefined;

        let publishedAt;
        if (pubDate) {
            const parsedDate = new Date(pubDate);
            if (!Number.isNaN(parsedDate.getTime())) publishedAt = parsedDate.toISOString();
        }

        const words = bodyText.split(/\s+/).filter(Boolean).length;
        posts.push(sanitizeRecord({
            type: 'POST',
            id: String(guid || slug || itemTitle),
            url: link || origin,
            title: itemTitle,
            slug,
            bodyText: bodyText || undefined,
            bodyHtml: contentHtml || undefined,
            description: desc || undefined,
            publicationName: title || undefined,
            publicationUrl: origin,
            primaryAuthor: creator,
            wordCount: words,
            readingTimeMinutes: words > 0 ? Math.ceil(words / 220) : 0,
            publishedAt,
            source: 'substack_rss',
            scrapedAt: new Date().toISOString()
        }));
    }

    return { publication, posts };
}

// Parse Substack Article Object
export function parsePostObject(postObj, origin, publicationMeta = {}, options = {}) {
    if (!postObj || typeof postObj !== 'object') return null;

    const extractFullText = options.extractFullText !== false;
    const id = postObj.id ?? postObj.slug;
    if (!id && !postObj.title) return null;

    const title = String(postObj.title || '').trim();
    const subtitle = String(postObj.subtitle || '').trim();
    const slug = String(postObj.slug || '').trim();
    const resolvedOrigin = origin || (postObj.canonical_url ? new URL(postObj.canonical_url).origin : '');
    const postUrl = postObj.canonical_url || (resolvedOrigin && slug ? `${resolvedOrigin}/p/${slug}` : resolvedOrigin);

    const bodyHtml = extractFullText ? (postObj.body_html || undefined) : undefined;
    const rawPlainFromHtml = bodyHtml ? htmlToPlainText(bodyHtml) : htmlToPlainText(postObj.body_html || '');
    const bodyText = (extractFullText ? rawPlainFromHtml : '')
        || String(postObj.truncated_body_text || postObj.description || subtitle || '').trim();
    const description = String(postObj.description || subtitle || '').trim();

    const coverImageUrl = postObj.cover_image || undefined;
    const isPaid = Boolean(postObj.audience === 'only_paid' || postObj.is_paid);
    const audience = postObj.audience || (isPaid ? 'only_paid' : 'everyone');

    const likesCount = parseSafeInt(postObj.reaction_count ?? postObj.reactions?.['❤'], 0);
    const commentsCount = parseSafeInt(postObj.comment_count, 0);
    const restacksCount = parseSafeInt(postObj.restacks, 0);
    const computedWords = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
    const wordCount = parseSafeInt(postObj.wordcount ?? postObj.word_count, 0) || computedWords;
    const readingTimeMinutes = wordCount > 0 ? Math.ceil(wordCount / 220) : 0;

    // Authors & Bylines
    const authors = [];
    const bylines = Array.isArray(postObj.publishedBylines) ? postObj.publishedBylines : [];
    for (const b of bylines) {
        if (!b || typeof b !== 'object') continue;
        authors.push(sanitizeRecord({
            id: b.id,
            name: b.name,
            handle: b.handle,
            bio: b.bio,
            photoUrl: b.photo_url,
            twitter: b.twitter_screen_name ? `https://x.com/${b.twitter_screen_name}` : undefined
        }));
    }

    const publicationName = publicationMeta.publicationName || publicationMeta.name || undefined;
    const publicationLogoUrl = publicationMeta.publicationLogoUrl || publicationMeta.logo_url || undefined;
    const primaryAuthor = authors[0]?.name || postObj.author || publicationMeta.primaryAuthor || publicationMeta.author_name || publicationName;

    const combinedText = `${title} ${subtitle} ${description} ${bodyText.slice(0, 5000)}`;
    const emails = extractEmails(combinedText);
    const phones = extractPhones(combinedText);
    const socialLinks = extractSocialLinks(combinedText);

    return sanitizeRecord({
        type: 'POST',
        id: String(id),
        url: postUrl,
        title,
        subtitle: subtitle || undefined,
        slug: slug || undefined,
        bodyText: bodyText || undefined,
        bodyHtml,
        description: description || undefined,
        publicationName,
        publicationUrl: resolvedOrigin || undefined,
        publicationLogoUrl,
        primaryAuthor,
        authors: authors.length > 0 ? authors : undefined,
        coverImageUrl,
        likesCount,
        commentsCount,
        restacksCount,
        isPaid,
        audience,
        wordCount,
        readingTimeMinutes,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        socialLinks: socialLinks.length > 0 ? socialLinks : undefined,
        publishedAt: postObj.post_date || undefined,
        scrapedAt: new Date().toISOString()
    });
}

// Parse & flatten nested Reader Comments up to maxComments
export function parseCommentsList(comments, postUrl, postId, maxComments = 100) {
    if (!Array.isArray(comments) || maxComments <= 0) return [];

    const out = [];
    const seen = new Set();

    const walk = (list) => {
        if (!Array.isArray(list)) return;
        for (const c of list) {
            if (out.length >= maxComments) break;
            if (!c || typeof c !== 'object') continue;

            const commentText = htmlToPlainText(c.body) || String(c.body || '').trim();
            const cId = c.id !== undefined ? String(c.id) : '';
            if (commentText && (!cId || !seen.has(cId)) && !c.deleted) {
                if (cId) seen.add(cId);
                out.push(sanitizeRecord({
                    type: 'COMMENT',
                    id: cId || `${postId}-${out.length + 1}`,
                    postId: String(postId),
                    url: postUrl,
                    commentText,
                    commentAuthor: c.name || c.user?.name || c.handle || undefined,
                    commentHandle: c.handle || c.user?.handle || undefined,
                    commentLikes: parseSafeInt(c.reaction_count, 0),
                    publishedAt: c.date || undefined,
                    scrapedAt: new Date().toISOString()
                }));
            }

            if (Array.isArray(c.children) && c.children.length > 0 && out.length < maxComments) {
                walk(c.children);
            }
        }
    };

    walk(comments);
    return out;
}

// Parse global /api/v1/top/search items (posts, comments/notes, and legacy search items)
export function parseSearchItem(item, keyword, options = {}) {
    if (!item || typeof item !== 'object') return null;
    const scrapedAt = new Date().toISOString();

    // Shape 1: /api/v1/top/search -> { type: 'post', post: {...}, publication: {...}, context: {...} }
    if (item.post && typeof item.post === 'object') {
        const pubObj = item.publication || {};
        const pubOrigin = pubObj.custom_domain
            ? `https://${pubObj.custom_domain.replace(/^https?:\/\//i, '')}`
            : (pubObj.subdomain ? `https://${pubObj.subdomain}.substack.com` : undefined);
        const parsedPost = parsePostObject(item.post, pubOrigin || '', pubObj, options);
        if (!parsedPost) return null;

        const ctxAuthor = item.context?.users?.[0]?.name;
        return sanitizeRecord({
            ...parsedPost,
            type: 'SEARCH_RESULT',
            primaryAuthor: parsedPost.primaryAuthor || ctxAuthor,
            publicationName: parsedPost.publicationName || pubObj.name,
            publicationUrl: parsedPost.publicationUrl || pubOrigin,
            publicationLogoUrl: parsedPost.publicationLogoUrl || pubObj.logo_url,
            searchQuery: keyword,
            scrapedAt
        });
    }

    // Shape 2: /api/v1/top/search -> { type: 'comment', comment: {...}, context: { users: [...] } } (Substack Note)
    if (item.comment && typeof item.comment === 'object') {
        const c = item.comment;
        const user = item.context?.users?.[0] || {};
        const handle = c.handle || user.handle || '';
        const text = htmlToPlainText(c.body) || String(c.body || '').trim();
        if (!text) return null;

        const noteUrl = handle && c.id
            ? `https://substack.com/@${handle}/note/c-${c.id}`
            : (c.id ? `https://substack.com/note/c-${c.id}` : 'https://substack.com');

        const titleLine = text.split('\n').find(Boolean) || text;
        const title = titleLine.length > 120 ? `${titleLine.slice(0, 117)}...` : titleLine;
        const pub = c.user_primary_publication || item.publication || {};

        return sanitizeRecord({
            type: 'SEARCH_RESULT',
            id: String(c.id || item.entity_key || title),
            url: noteUrl,
            title,
            bodyText: text,
            description: text.slice(0, 300),
            publicationName: pub.name || undefined,
            publicationUrl: pub.custom_domain
                ? `https://${pub.custom_domain.replace(/^https?:\/\//i, '')}`
                : (pub.subdomain ? `https://${pub.subdomain}.substack.com` : undefined),
            primaryAuthor: c.name || user.name || handle || undefined,
            likesCount: parseSafeInt(c.reaction_count, 0),
            commentsCount: parseSafeInt(c.children_count, 0),
            restacksCount: parseSafeInt(c.restacks, 0),
            wordCount: text.split(/\s+/).filter(Boolean).length,
            searchQuery: keyword,
            publishedAt: c.date || item.context?.timestamp || undefined,
            scrapedAt
        });
    }

    // Shape 3: Legacy flat search result
    const fallbackUrl = item.canonical_url || item.url || (item.slug ? `https://substack.com/p/${item.slug}` : undefined);
    const id = item.id || item.slug || fallbackUrl;
    if (!id && !item.title && !item.name) return null;

    return sanitizeRecord({
        type: 'SEARCH_RESULT',
        id: String(id),
        url: fallbackUrl || 'https://substack.com',
        title: item.title || item.name || undefined,
        subtitle: item.subtitle || item.description || undefined,
        publicationName: item.publication?.name || undefined,
        primaryAuthor: item.author?.name || undefined,
        searchQuery: keyword,
        publishedAt: item.post_date || undefined,
        scrapedAt
    });
}
