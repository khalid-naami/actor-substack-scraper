/**
 * Substack Ultimate Scraper - Extractors & Parsers
 * High-speed parsing for Publications, Full Articles, Comments, and Discovery.
 */

// Helper to extract email addresses
export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['substack.com', 'substack-custom-domains.com', 'example.com'];
    const unique = [...new Set(matches.map(m => m.trim().toLowerCase()))];
    return unique.filter(e => !ignored.some(d => e.endsWith(`@${d}`)));
}

// Helper to extract phone numbers
export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map(p => p.trim())
        .filter(p => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

// Convert HTML to clean plain text for AI & LLMs
export function htmlToPlainText(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<li>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
}

// Parse Substack Article Object
export function parsePostObject(postObj, origin, publicationMeta = {}) {
    if (!postObj || typeof postObj !== 'object') return null;

    const id = postObj.id;
    const title = postObj.title || '';
    const subtitle = postObj.subtitle || '';
    const slug = postObj.slug || '';
    const postUrl = postObj.canonical_url || `${origin}/p/${slug}`;

    const bodyHtml = postObj.body_html || '';
    const bodyText = htmlToPlainText(bodyHtml) || postObj.description || '';
    const description = postObj.description || subtitle;

    const coverImageUrl = postObj.cover_image || null;
    const isPaid = Boolean(postObj.audience === 'only_paid' || postObj.is_paid);
    const audience = postObj.audience || (isPaid ? 'only_paid' : 'everyone');

    const likesCount = postObj.reaction_count || postObj.reactions?.['❤'] || 0;
    const commentsCount = postObj.comment_count || 0;
    const wordCount = postObj.word_count || bodyText.split(/\s+/).filter(Boolean).length;
    const readingTime = Math.ceil(wordCount / 220);

    // Authors & Bylines
    const authors = [];
    const bylines = postObj.publishedBylines || [];
    for (const b of bylines) {
        authors.push({
            id: b.id,
            name: b.name,
            handle: b.handle,
            bio: b.bio,
            photoUrl: b.photo_url,
            twitter: b.twitter_screen_name ? `https://x.com/${b.twitter_screen_name}` : null
        });
    }

    const primaryAuthor = authors[0]?.name || postObj.author || publicationMeta.name || null;

    const combinedText = `${title} ${subtitle} ${description} ${bodyText.slice(0, 5000)}`;
    const emails = extractEmails(combinedText);
    const phones = extractPhones(combinedText);

    return {
        type: 'POST',
        id: String(id),
        url: postUrl,
        title,
        subtitle,
        slug,
        bodyText,
        bodyHtml: bodyHtml || undefined,
        description,
        publicationName: publicationMeta.name || null,
        publicationUrl: origin,
        primaryAuthor,
        authors: authors.length > 0 ? authors : undefined,
        coverImageUrl,
        likesCount,
        commentsCount,
        isPaid,
        audience,
        wordCount,
        readingTimeMinutes: readingTime,
        email: emails[0] || null,
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        publishedAt: postObj.post_date || null,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Publication Metadata
export function parsePublicationMeta(pubObj, origin) {
    if (!pubObj || typeof pubObj !== 'object') return null;

    const name = pubObj.name || '';
    const subdomain = pubObj.subdomain || '';
    const description = pubObj.hero_text || pubObj.author_bio || '';
    const logoUrl = pubObj.logo_url || null;
    const coverUrl = pubObj.cover_image_url || null;

    const emails = extractEmails(`${name} ${description}`);
    const phones = extractPhones(`${name} ${description}`);

    return {
        type: 'PUBLICATION',
        id: pubObj.id || subdomain,
        url: origin,
        publicationName: name,
        publicationSubdomain: subdomain,
        description,
        publicationLogoUrl: logoUrl,
        coverImageUrl: coverUrl,
        email: emails[0] || null,
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Reader Comments
export function parseCommentsList(comments, postUrl, postId) {
    if (!Array.isArray(comments)) return [];

    return comments.map(c => {
        return {
            type: 'COMMENT',
            id: String(c.id),
            postId: String(postId),
            url: postUrl,
            commentText: htmlToPlainText(c.body) || c.body || '',
            commentAuthor: c.name || c.user?.name || null,
            commentLikes: c.reaction_count || 0,
            publishedAt: c.date || null,
            scrapedAt: new Date().toISOString()
        };
    });
}
