import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { log } from 'crawlee';
import {
    sanitizeRecord,
    normalizeSubstackUrl,
    detectSubstackTargetType,
    extractSearchQueryFromUrl,
    extractPreloadsFromHtml,
    parsePostObject,
    parsePublicationMeta,
    parseRssFeed,
    parseCommentsList,
    parseSearchItem
} from './extractors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isProxyTransportError(errOrStatus) {
    const msg = String(errOrStatus?.message || errOrStatus || '');
    return errOrStatus === 597 || errOrStatus === 407 || /597|UPSTREAM407|407|Proxy responded with|tunneling socket/i.test(msg);
}

await Actor.init();

const diagnostics = [];
function addDiagnostic(msg) {
    if (msg && !diagnostics.includes(msg)) {
        diagnostics.push(msg);
    }
}

try {
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

    const targetMaxPosts = maxPosts === 0 ? Infinity : Math.max(1, Number(maxPosts) || 30);
    const targetMaxComments = Math.max(0, Number(maxComments) ?? 20);

    log.info('🚀 Starting Substack Ultimate Scraper...', {
        mode,
        targetUrlsCount: Array.isArray(targetUrls) ? targetUrls.length : 0,
        searchKeywordsCount: Array.isArray(searchKeywords) ? searchKeywords.length : 0,
        maxPosts,
        maxComments: targetMaxComments,
        extractFullText
    });

    let proxyConfig;
    if (proxyConfiguration) {
        try {
            proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
        } catch (err) {
            log.warning(`⚠️ Proxy initialization failed (${err.message}). Continuing without Apify proxy.`);
            addDiagnostic(`Proxy initialization skipped: ${err.message}`);
            proxyConfig = undefined;
        }
    }

    let rawTargets = Array.isArray(targetUrls) ? [...targetUrls] : [];
    const keywordsQueue = Array.isArray(searchKeywords)
        ? searchKeywords.map((k) => String(k || '').trim()).filter(Boolean)
        : [];

    if (rawTargets.length === 0 && keywordsQueue.length === 0) {
        if (mode === 'SEARCH') {
            keywordsQueue.push('artificial intelligence agents');
            log.info('ℹ️ No inputs provided in SEARCH mode. Defaulting to sample search keyword:', { keywords: keywordsQueue });
        } else {
            rawTargets = ['https://thealgorithmicbridge.substack.com'];
            log.info('ℹ️ No inputs provided. Defaulting to sample Substack target:', { urls: rawTargets });
        }
    }

    async function httpRequest(url, { accept = 'application/json, text/plain, */*', parseJson = false } = {}) {
        const maxAttempts = proxyConfig ? 3 : 2;
        let lastErr = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
            try {
                const res = await gotScraping({
                    url,
                    headerGeneratorOptions: {
                        browsers: [{ name: 'chrome', minVersion: 124 }],
                        operatingSystems: ['windows', 'macos']
                    },
                    headers: {
                        'Accept': accept,
                        'Accept-Language': 'en-US,en;q=0.9'
                    },
                    proxyUrl,
                    responseType: 'text',
                    throwHttpErrors: false,
                    timeout: { request: 25000 },
                    retry: { limit: 0 }
                });

                const statusCode = res.statusCode;
                const bodyText = typeof res.body === 'string' ? res.body : String(res.body || '');

                if (proxyUrl && (isProxyTransportError(statusCode) || isProxyTransportError(bodyText))) {
                    log.warning(`⚠️ Proxy transport error (HTTP ${statusCode}); disabling broken proxy and retrying direct...`);
                    proxyConfig = undefined;
                    continue;
                }

                const lowerSnippet = bodyText.slice(0, 4096).toLowerCase();

                const isCloudflare =
                    lowerSnippet.includes('just a moment...') ||
                    lowerSnippet.includes('cf-browser-verification') ||
                    lowerSnippet.includes('cf-turnstile') ||
                    lowerSnippet.includes('attention required! | cloudflare');

                if (statusCode === 429 || (statusCode >= 500 && statusCode < 600) || isCloudflare) {
                    const reason = isCloudflare
                        ? `Cloudflare challenge (HTTP ${statusCode})`
                        : `HTTP ${statusCode} from Substack`;
                    lastErr = new Error(`${reason} on ${url}`);
                    if (attempt + 1 < maxAttempts) {
                        log.warning(`⏳ ${reason}. Retrying (${attempt + 1}/${maxAttempts})...`);
                        await sleep(2000 * (attempt + 1));
                        continue;
                    }
                    throw lastErr;
                }

                if (statusCode >= 400) {
                    throw new Error(`HTTP ${statusCode} on ${url}: ${bodyText.slice(0, 160).replace(/\s+/g, ' ')}`);
                }

                if (parseJson) {
                    try {
                        const data = JSON.parse(bodyText);
                        return { statusCode, finalUrl: res.url, data, text: bodyText };
                    } catch (jsonErr) {
                        throw new Error(`Invalid JSON response from ${url}: ${jsonErr.message}`);
                    }
                }

                return { statusCode, finalUrl: res.url, text: bodyText };
            } catch (err) {
                lastErr = err;
                if (proxyUrl && isProxyTransportError(err)) {
                    log.warning(`⚠️ Proxy transport error (${err.message}); disabling broken proxy and retrying direct...`);
                    proxyConfig = undefined;
                    continue;
                }
                if (attempt + 1 < maxAttempts && /timeout|ECONNRESET|ETIMEDOUT|socket/i.test(err.message)) {
                    await sleep(1500);
                    continue;
                }
                throw err;
            }
        }

        throw lastErr || new Error(`Request failed for ${url}`);
    }

    async function fetchJson(url) {
        const res = await httpRequest(url, {
            accept: 'application/json, text/plain, */*',
            parseJson: true
        });
        return res;
    }

    async function fetchPublicationContext(origin) {
        let resolvedOrigin = origin;
        let pubMeta = null;
        let rssFallback = { publication: null, posts: [] };

        // Primary: Homepage HTML embeds window._preloads inside <script id="preloads-json">
        try {
            const homeRes = await httpRequest(`${origin}/`, {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                parseJson: false
            });
            if (homeRes.finalUrl) {
                try {
                    resolvedOrigin = new URL(homeRes.finalUrl).origin;
                } catch (_) {}
            }
            const preloads = extractPreloadsFromHtml(homeRes.text);
            if (preloads?.pub) {
                pubMeta = parsePublicationMeta(preloads.pub, resolvedOrigin);
            }
        } catch (err) {
            log.debug(`Homepage _preloads lookup skipped for ${origin}: ${err.message}`);
        }

        // Secondary: RSS /feed for publication info (works cleanly across custom domains)
        if (!pubMeta) {
            try {
                const feedRes = await httpRequest(`${resolvedOrigin}/feed`, {
                    accept: 'application/rss+xml, application/xml, text/xml, */*',
                    parseJson: false
                });
                rssFallback = parseRssFeed(feedRes.text, resolvedOrigin, { extractFullText });
                if (rssFallback.publication) {
                    pubMeta = rssFallback.publication;
                }
            } catch (err) {
                log.debug(`RSS fallback skipped for ${resolvedOrigin}: ${err.message}`);
            }
        }

        return { resolvedOrigin, pubMeta: pubMeta || {}, rssPosts: rssFallback.posts };
    }

    async function fetchCommentsForPost(origin, postId, postUrl, maxLimit) {
        if (!postId || maxLimit <= 0) return [];
        const endpoints = [
            `${origin}/api/v1/post/${postId}/comments?all_comments=true&sort=top`,
            `${origin}/api/v1/posts/${postId}/comments?sort=top`
        ];

        for (let i = 0; i < endpoints.length; i++) {
            try {
                const res = await fetchJson(endpoints[i]);
                if (Array.isArray(res.data?.comments)) {
                    return parseCommentsList(res.data.comments, postUrl, postId, maxLimit);
                }
            } catch (err) {
                if (i === endpoints.length - 1) {
                    log.debug(`Comments fetch note for post ${postId}: ${err.message}`);
                }
            }
        }
        return [];
    }

    const stats = {
        publications: 0,
        posts: 0,
        comments: 0,
        searchResults: 0,
        failed: 0
    };

    // 1. PROCESS TARGET URLS
    for (const rawItem of rawTargets) {
        const url = normalizeSubstackUrl(rawItem);
        if (!url) {
            log.warning('⚠️ Skipping invalid Substack URL:', { rawItem });
            addDiagnostic(`Invalid Substack target URL skipped: ${JSON.stringify(rawItem)}`);
            stats.failed++;
            continue;
        }

        const currentMode = detectSubstackTargetType(url, mode);
        if (currentMode === 'SEARCH') {
            const q = extractSearchQueryFromUrl(url);
            if (q) {
                keywordsQueue.push(q);
                continue;
            }
        }

        try {
            const parsedUrl = new URL(url);
            const rawOrigin = parsedUrl.origin;
            const slugMatch = parsedUrl.pathname.match(/\/p\/([a-zA-Z0-9_-]+)/);
            const postSlug = slugMatch ? slugMatch[1] : null;

            log.info(`🎯 Processing [${currentMode}]: ${url} (Origin: ${rawOrigin})`);

            const { resolvedOrigin, pubMeta, rssPosts } = await fetchPublicationContext(rawOrigin);

            let urlPubPushed = false;
            if (currentMode === 'PUBLICATIONS' && !postSlug && pubMeta?.publicationName) {
                await Actor.pushData(sanitizeRecord(pubMeta));
                stats.publications++;
                urlPubPushed = true;
                log.info(`📰 Scraped Publication: "${pubMeta.publicationName}" (${resolvedOrigin})`);
            }

            // CASE A: SPECIFIC POST URL (/p/<slug>)
            if (postSlug) {
                const postRes = await fetchJson(`${resolvedOrigin}/api/v1/posts/${postSlug}`);
                const post = parsePostObject(postRes.data, resolvedOrigin, pubMeta, { extractFullText });
                if (!post) {
                    throw new Error(`Could not parse Substack post payload from ${url}`);
                }
                post.source = 'substack_api';

                if (currentMode !== 'COMMENTS') {
                    await Actor.pushData(sanitizeRecord(post));
                    stats.posts++;
                    log.info(`✅ Scraped Article: "${post.title}" [Words: ${post.wordCount || 0}, Likes: ${post.likesCount || 0}]`);
                }

                const commentQuota = currentMode === 'COMMENTS' && targetMaxComments === 0 ? 20 : targetMaxComments;
                if (commentQuota > 0 && post.id && (currentMode === 'COMMENTS' || post.commentsCount > 0)) {
                    const comments = await fetchCommentsForPost(resolvedOrigin, post.id, post.url, commentQuota);
                    for (const c of comments) {
                        c.source = 'substack_comments_api';
                        await Actor.pushData(sanitizeRecord(c));
                        stats.comments++;
                    }
                    log.info(`💬 Extracted ${comments.length} comments for "${post.title}"`);
                }
                continue;
            }

            // CASE B: PUBLICATION URL (Archive Posts + optional Comments)
            let cursor = '';
            let collected = 0;
            let urlComments = 0;
            const limit = Number.isFinite(targetMaxPosts) ? Math.min(25, targetMaxPosts) : 25;
            const seenCursors = new Set();
            const seenPostIds = new Set();
            let archiveFailedErr = null;

            while (collected < targetMaxPosts) {
                const archiveUrl = cursor
                    ? `${resolvedOrigin}/api/v1/archive?sort=new&limit=${limit}&cursor=${encodeURIComponent(cursor)}`
                    : `${resolvedOrigin}/api/v1/archive?sort=new&limit=${limit}`;

                let archivePayload;
                try {
                    const res = await fetchJson(archiveUrl);
                    archivePayload = res.data;
                } catch (err) {
                    archiveFailedErr = err;
                    break;
                }

                const postsList = Array.isArray(archivePayload)
                    ? archivePayload
                    : (Array.isArray(archivePayload?.posts) ? archivePayload.posts : []);
                const nextCursor = archivePayload?.nextCursor || '';

                if (postsList.length === 0) break;

                for (const postObj of postsList) {
                    if (collected >= targetMaxPosts) break;
                    const dedupId = String(postObj.id || postObj.slug || '');
                    if (dedupId && seenPostIds.has(dedupId)) continue;
                    if (dedupId) seenPostIds.add(dedupId);

                    let finalPostObj = postObj;
                    const needsFullFetch = extractFullText && postObj.slug && !postObj.body_html && currentMode !== 'COMMENTS';
                    if (needsFullFetch) {
                        try {
                            const fullRes = await fetchJson(`${resolvedOrigin}/api/v1/posts/${postObj.slug}`);
                            if (fullRes.data && typeof fullRes.data === 'object') {
                                finalPostObj = { ...postObj, ...fullRes.data };
                            }
                        } catch (fullErr) {
                            log.debug(`Full body fetch note for ${postObj.slug}: ${fullErr.message}`);
                        }
                    }

                    const post = parsePostObject(finalPostObj, resolvedOrigin, pubMeta, { extractFullText });
                    if (!post) continue;
                    post.source = 'substack_archive_api';

                    if (currentMode !== 'COMMENTS') {
                        await Actor.pushData(sanitizeRecord(post));
                        collected++;
                        stats.posts++;
                    }

                    const commentQuota = currentMode === 'COMMENTS' && targetMaxComments === 0 ? 20 : targetMaxComments;
                    if (commentQuota > 0 && post.id && post.commentsCount > 0) {
                        const comments = await fetchCommentsForPost(resolvedOrigin, post.id, post.url, commentQuota);
                        for (const c of comments) {
                            c.source = 'substack_comments_api';
                            await Actor.pushData(sanitizeRecord(c));
                            stats.comments++;
                            urlComments++;
                        }
                        if (currentMode === 'COMMENTS') {
                            collected++;
                        }
                    }
                }

                log.info(`📜 Processed ${collected}${Number.isFinite(targetMaxPosts) ? `/${targetMaxPosts}` : ''} items from ${pubMeta.publicationName || resolvedOrigin}...`);

                if (!nextCursor || seenCursors.has(nextCursor)) break;
                seenCursors.add(nextCursor);
                cursor = nextCursor;
            }

            // Fallback to RSS feed items if archive API was blocked or empty
            if (collected === 0 && rssPosts.length > 0 && currentMode !== 'COMMENTS') {
                log.warning(`⚠️ Archive API yielded 0 posts${archiveFailedErr ? ` (${archiveFailedErr.message})` : ''}; falling back to RSS feed (${rssPosts.length} posts).`);
                for (const rssPost of rssPosts) {
                    if (collected >= targetMaxPosts) break;
                    await Actor.pushData(sanitizeRecord(rssPost));
                    collected++;
                    stats.posts++;
                }
            } else if (collected === 0 && archiveFailedErr) {
                throw archiveFailedErr;
            }

            if (collected === 0 && urlComments === 0 && !urlPubPushed) {
                addDiagnostic(`No articles/comments extracted from ${resolvedOrigin}.`);
                stats.failed++;
            } else {
                log.info(`✅ Finished ${pubMeta.publicationName || resolvedOrigin}: ${collected} articles processed.`);
            }
        } catch (err) {
            log.error(`❌ Error processing ${url}: ${err.message}`);
            addDiagnostic(`${url} -> ${err.message}`);
            stats.failed++;
        }
    }

    // 2. PROCESS SEARCH KEYWORDS
    if (keywordsQueue.length > 0) {
        const searchLimit = Number.isFinite(targetMaxPosts) ? targetMaxPosts : 100;

        for (const keyword of keywordsQueue) {
            log.info(`🔍 Searching Substack for: "${keyword}"`);
            try {
                let cursor = '';
                let count = 0;
                const seenKeys = new Set();
                const seenCursors = new Set();

                while (count < searchLimit) {
                    const searchApi = cursor
                        ? `https://substack.com/api/v1/top/search?query=${encodeURIComponent(keyword)}&cursor=${encodeURIComponent(cursor)}`
                        : `https://substack.com/api/v1/top/search?query=${encodeURIComponent(keyword)}`;

                    const res = await fetchJson(searchApi);
                    const items = Array.isArray(res.data?.items)
                        ? res.data.items
                        : (Array.isArray(res.data?.results) ? res.data.results : []);
                    const nextCursor = res.data?.nextCursor || '';

                    if (items.length === 0) break;

                    for (const item of items) {
                        if (count >= searchLimit) break;
                        const parsed = parseSearchItem(item, keyword, { extractFullText });
                        if (!parsed) continue;

                        const dedupKey = item.entity_key || parsed.id;
                        if (dedupKey && seenKeys.has(dedupKey)) continue;
                        if (dedupKey) seenKeys.add(dedupKey);

                        parsed.source = 'substack_search_api';
                        await Actor.pushData(sanitizeRecord(parsed));
                        count++;
                        stats.searchResults++;
                    }

                    if (!nextCursor || seenCursors.has(nextCursor)) break;
                    seenCursors.add(nextCursor);
                    cursor = nextCursor;
                }

                if (count === 0) {
                    log.warning(`⚠️ Search returned 0 results for "${keyword}".`);
                    addDiagnostic(`Search "${keyword}" returned 0 results.`);
                    stats.failed++;
                } else {
                    log.info(`✅ Discovered and scraped ${count} search results for "${keyword}"`);
                }
            } catch (err) {
                log.error(`❌ Search failed for "${keyword}": ${err.message}`);
                addDiagnostic(`Search "${keyword}" -> ${err.message}`);
                stats.failed++;
            }
        }
    }

    const totalRecordsExtracted = stats.publications + stats.posts + stats.comments + stats.searchResults;
    const status = totalRecordsExtracted === 0
        ? 'FAILED'
        : (stats.failed > 0 ? 'PARTIAL_SUCCESS' : 'COMPLETED');

    const summary = {
        status,
        timestamp: new Date().toISOString(),
        metrics: stats,
        totalRecordsExtracted,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        message: totalRecordsExtracted === 0
            ? 'Substack Ultimate Scraper extracted 0 records. See diagnostics for details.'
            : (stats.failed > 0
                ? 'Substack Ultimate Scraper completed with partial failures (check diagnostics).'
                : 'Substack Ultimate Scraper completed successfully.')
    };

    await Actor.setValue('OUTPUT', summary);
    log.info('🏁 Execution Finished. Executive Summary:', summary);

    if (totalRecordsExtracted === 0) {
        const reasonSummary = diagnostics[0] || 'All targets failed or returned 0 extractable records.';
        await Actor.fail(`Extracted 0 Substack records. ${reasonSummary}`);
    } else {
        await Actor.exit();
    }
} catch (fatalErr) {
    log.error(`💥 Fatal Actor error: ${fatalErr.message}`, { stack: fatalErr.stack });
    await Actor.setValue('OUTPUT', {
        status: 'FAILED',
        timestamp: new Date().toISOString(),
        totalRecordsExtracted: 0,
        diagnostics: [fatalErr.message, ...diagnostics],
        message: `Fatal error: ${fatalErr.message}`
    }).catch(() => {});
    await Actor.fail(fatalErr.message);
}
