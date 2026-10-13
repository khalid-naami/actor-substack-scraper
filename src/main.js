import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { log } from 'crawlee';
import {
    parsePostObject,
    parsePublicationMeta,
    parseCommentsList
} from './extractors.js';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    mode = 'AUTO_DETECT',
    targetUrls = [],
    searchKeywords = [],
    maxPosts = 30,
    maxComments = 20,
    extractFullText = true,
    proxyConfiguration
} = input;

log.info('🚀 Starting Substack Ultimate Scraper...', {
    mode,
    targetUrlsCount: targetUrls.length,
    searchKeywordsCount: searchKeywords.length,
    maxPosts
});

const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

let urlsToProcess = [...targetUrls];
let keywordsToProcess = [...searchKeywords];

if (urlsToProcess.length === 0 && keywordsToProcess.length === 0) {
    urlsToProcess = [
        'https://thealgorithmicbridge.substack.com'
    ];
    log.info('ℹ️ No inputs provided. Defaulting to sample Substack target:', { urls: urlsToProcess });
}

function buildHeaders() {
    return {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    };
}

async function fetchJson(url) {
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    const response = await gotScraping({
        url,
        headers: buildHeaders(),
        proxyUrl,
        responseType: 'json',
        timeout: { request: 25000 },
        retry: { limit: 2 }
    });
    return response.body;
}

const stats = {
    publications: 0,
    posts: 0,
    comments: 0,
    searchResults: 0,
    failed: 0
};

// 1. PROCESS TARGET URLS
for (const rawUrl of urlsToProcess) {
    const url = rawUrl.trim();
    if (!url) continue;

    try {
        const parsedUrl = new URL(url);
        const origin = parsedUrl.origin;
        const isSinglePost = parsedUrl.pathname.includes('/p/');
        const slugMatch = parsedUrl.pathname.match(/\/p\/([a-zA-Z0-9_-]+)/);
        const postSlug = slugMatch ? slugMatch[1] : null;

        log.info(`🎯 Processing Substack target: ${url} (Origin: ${origin})`);

        // Fetch publication metadata
        let pubMeta = {};
        try {
            const pubData = await fetchJson(`${origin}/api/v1/publication`);
            pubMeta = parsePublicationMeta(pubData, origin) || {};
            if (pubMeta.publicationName) {
                await Actor.pushData(pubMeta);
                stats.publications++;
                log.info(`📰 Scraped Publication: "${pubMeta.publicationName}" (${origin})`);
            }
        } catch (_) {}

        // CASE A: SPECIFIC POST
        if (isSinglePost && postSlug) {
            try {
                const postData = await fetchJson(`${origin}/api/v1/posts/${postSlug}`);
                const post = parsePostObject(postData, origin, pubMeta);
                if (post) {
                    await Actor.pushData(post);
                    stats.posts++;
                    log.info(`✅ Scraped Article: "${post.title}" [Words: ${post.wordCount}, Likes: ${post.likesCount}]`);

                    // Extract comments
                    if (maxComments > 0 && post.id) {
                        try {
                            const cData = await fetchJson(`${origin}/api/v1/posts/${post.id}/comments?sort=top`);
                            const comments = parseCommentsList(cData?.comments?.slice(0, maxComments) || [], post.url, post.id);
                            for (const c of comments) {
                                await Actor.pushData(c);
                            }
                            stats.comments += comments.length;
                            log.info(`💬 Extracted ${comments.length} comments for article: "${post.title}"`);
                        } catch (_) {}
                    }
                }
            } catch (err) {
                log.error(`❌ Failed scraping single post ${url}: ${err.message}`);
                stats.failed++;
            }
        }

        // CASE B: PUBLICATION ARCHIVE (ENTIRE NEWSLETTER)
        else {
            let offset = 0;
            let collected = 0;
            const limit = 25;

            while (collected < maxPosts) {
                const archiveUrl = `${origin}/api/v1/archive?sort=new&limit=${limit}&offset=${offset}`;
                const archiveData = await fetchJson(archiveUrl);

                if (!Array.isArray(archiveData) || archiveData.length === 0) break;

                for (const postObj of archiveData) {
                    if (collected >= maxPosts) break;

                    let finalPostObj = postObj;
                    // If full text is requested and body_html is missing from summary
                    if (extractFullText && postObj.slug && !postObj.body_html) {
                        try {
                            const fullData = await fetchJson(`${origin}/api/v1/posts/${postObj.slug}`);
                            if (fullData?.body_html) {
                                finalPostObj = { ...postObj, ...fullData };
                            }
                        } catch (_) {}
                    }

                    const post = parsePostObject(finalPostObj, origin, pubMeta);
                    if (post) {
                        await Actor.pushData(post);
                        collected++;
                        stats.posts++;

                        // Comments extraction
                        if (maxComments > 0 && post.id) {
                            try {
                                const cData = await fetchJson(`${origin}/api/v1/posts/${post.id}/comments?sort=top`);
                                const comments = parseCommentsList(cData?.comments?.slice(0, maxComments) || [], post.url, post.id);
                                for (const c of comments) {
                                    await Actor.pushData(c);
                                }
                                stats.comments += comments.length;
                            } catch (_) {}
                        }
                    }
                }

                offset += limit;
                log.info(`📜 Fetched ${collected}/${maxPosts} articles from ${pubMeta.publicationName || origin}...`);
                if (archiveData.length < limit) break;
            }

            log.info(`✅ Successfully scraped ${collected} articles from ${pubMeta.publicationName || origin}`);
        }

    } catch (err) {
        log.error(`❌ Error processing ${url}: ${err.message}`);
        stats.failed++;
    }
}

// 2. PROCESS SEARCH KEYWORDS
if (keywordsToProcess.length > 0) {
    for (const keyword of keywordsToProcess) {
        log.info(`🔍 Searching Substack for: "${keyword}"`);
        try {
            const searchApi = `https://substack.com/api/v1/reader/search?query=${encodeURIComponent(keyword)}`;
            const res = await fetchJson(searchApi);
            const results = res?.results || [];

            let count = 0;
            for (const item of results.slice(0, maxPosts)) {
                const post = {
                    type: 'SEARCH_RESULT',
                    id: String(item.id || item.slug),
                    title: item.title || item.name,
                    subtitle: item.subtitle || item.description,
                    url: item.canonical_url || item.url || (item.slug ? `https://substack.com/p/${item.slug}` : null),
                    publicationName: item.publication?.name || null,
                    primaryAuthor: item.author?.name || null,
                    searchQuery: keyword,
                    scrapedAt: new Date().toISOString()
                };
                await Actor.pushData(post);
                count++;
                stats.searchResults++;
            }

            log.info(`✅ Discovered and scraped ${count} search results for "${keyword}"`);
        } catch (err) {
            log.error(`❌ Search failed for "${keyword}": ${err.message}`);
            stats.failed++;
        }
    }
}

// Save summary report
const summary = {
    status: 'COMPLETED',
    timestamp: new Date().toISOString(),
    metrics: stats,
    totalRecordsExtracted: stats.publications + stats.posts + stats.comments + stats.searchResults,
    message: 'Substack Ultimate Scraper completed successfully.'
};

await Actor.setValue('OUTPUT', summary);
log.info('🏁 Execution Finished. Executive Summary:', summary);

await Actor.exit();
