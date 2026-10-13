# 📰 Substack Ultimate Scraper (Newsletters, Full Articles, Comments & Search)

High-speed, all-in-one Substack data extraction engine on Apify. Extract **Full Article Text & Markdown** (AI-ready for LLMs, RAG, and summarization), **Entire Newsletter Archives**, **Publication Metadata & Stats**, **Engagement Metrics** (Likes, Comments, Reactions), **Reader Comments**, and **Keyword Search** without requiring a login or account.

---

## ⚡ Key Features

- 📝 **AI-Ready Full Article Text & Markdown**: Extracts the complete article plain text (clean, unbloated by HTML) and HTML body — ideal for training LLMs, feeding RAG vector databases, research analysis, and AI summarization.
- 📚 **Full Publication Archives**: Scrapes an entire newsletter's archive of articles with automated pagination across standard Substack subdomains and custom domains.
- 👥 **Author Bylines & Contact Leads**: Extract author names, handles, bios, photos, Twitter/X profiles, and contact emails found in publications.
- 💬 **Reader Comments & Community Discussions**: Extracts top-voted comments and reader thoughts on articles.
- 📊 **Engagement & Paywall Metadata**: Scrapes reaction counts (`❤`), comment counts, word count, estimated reading time, and paywall tier status (`audience: everyone` vs `only_paid`).
- 🔍 **Global Keyword Search**: Search across all of Substack by topic or industry (e.g., *artificial intelligence*, *crypto*, *macroeconomics*) to discover trending newsletters.
- 🌐 **Zero Login Required**: Operates directly via public REST endpoints without requiring a Substack account, password, or cookies.
- 🛡️ **Blazing Fast Direct API Execution**: Ultra-lightweight HTTP execution powered by `got-scraping` with Apify Proxy support.

---

## 📥 Input Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | String | `AUTO_DETECT` | Extraction mode: `AUTO_DETECT`, `PUBLICATIONS`, `POSTS`, `COMMENTS`, `SEARCH`. |
| `targetUrls` | Array | `[...]` | List of Substack Publication URLs (or specific article URLs). |
| `searchKeywords` | Array | `[]` | Keywords to discover newsletters and articles across Substack. |
| `maxPosts` | Integer | `30` | Maximum articles to extract per newsletter (0 for full archive). |
| `maxComments` | Integer | `20` | Maximum reader comments to extract per article. |
| `extractFullText` | Boolean | `true` | Extract full article body text and markdown for AI/LLM workflows. |
| `proxyConfiguration` | Object | `{ useApifyProxy: true }` | Apify Residential proxy configuration (recommended). |

---

## 📤 Output Data Format

### 1. Substack Article Record (AI & LLM Ready)

```json
{
  "type": "POST",
  "id": "145678901",
  "url": "https://thealgorithmicbridge.substack.com/p/why-ai-agents-matter",
  "title": "Why AI Agents Are the Next Computing Platform",
  "subtitle": "An in-depth analysis of autonomous agentic architectures.",
  "slug": "why-ai-agents-matter",
  "bodyText": "Over the past six months, the focus of generative AI has decisively shifted from static chatbots to autonomous agentic loops...",
  "publicationName": "The Algorithmic Bridge",
  "publicationUrl": "https://thealgorithmicbridge.substack.com",
  "primaryAuthor": "Alberto Romero",
  "coverImageUrl": "https://substackcdn.com/image/fetch/...",
  "likesCount": 420,
  "commentsCount": 35,
  "isPaid": false,
  "audience": "everyone",
  "wordCount": 1850,
  "readingTimeMinutes": 9,
  "publishedAt": "2026-10-08T14:00:00.000Z",
  "scrapedAt": "2026-10-09T22:45:00.000Z"
}
```

### 2. Publication Record

```json
{
  "type": "PUBLICATION",
  "id": "thealgorithmicbridge",
  "url": "https://thealgorithmicbridge.substack.com",
  "publicationName": "The Algorithmic Bridge",
  "publicationSubdomain": "thealgorithmicbridge",
  "description": "Bridging the gap between artificial intelligence, philosophy, and society.",
  "publicationLogoUrl": "https://substackcdn.com/image/fetch/...",
  "scrapedAt": "2026-10-09T22:45:00.000Z"
}
```

---

## 💼 AI, Research & Market Intelligence Use Cases

- **AI Model Pretraining & RAG Pipelines**: Feed rich, high-quality, long-form expert essays into vector databases (Pinecone, Chroma, Qdrant) and language models.
- **Financial & Market Newsletter Sourcing**: Monitor independent equity analysts, crypto newsletters, and macro economists for real-time market signals.
- **Thought Leader & PR Prospecting**: Find influential newsletter writers in your vertical for podcast bookings, guest writing, or sponsor spots.

---

## 📄 License
Apache-2.0
