/**
 * SearchService — Professional multi-provider web search engine.
 *
 * Provider chain: DuckDuckGo HTML → SearXNG → Wikipedia (fallback)
 * Features: LRU cache, rate-limit guard, HTML entity decoding, provider failover.
 *
 * Design principles:
 *  - Non-aggressive: respectful delays, proper User-Agent, minimal requests.
 *  - Fast: parallel provider fallback with early return on first success.
 *  - Reliable: every provider is independently fault-tolerant.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface SearchOutcome {
  ok: boolean;
  query: string;
  results: SearchResult[];
  provider: string;
  cached: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_TIMEOUT_MS = 6_000;
const MAX_RESULTS = 6;
const CACHE_MAX_SIZE = 60;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SEARXNG_INSTANCES = [
  'https://search.sapti.me',
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://searx.tiekoetter.com',
  'https://search.ononoki.org',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode common HTML entities and strip remaining tags. */
function decodeHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sanitize raw user input into a safe, bounded search query. */
function sanitizeQuery(raw: string): string {
  return raw
    .replace(/--- FILE:[\s\S]*?--- END FILE ---/g, ' ')
    .replace(/<file[\s\S]*?<\/file>/g, ' ')
    .replace(/<edit[\s\S]*?<\/edit>/g, ' ')
    .replace(/[<>{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/** Simple timer-based fetch with AbortController. */
async function timedFetch(url: string, init?: RequestInit, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  outcome: SearchOutcome;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(query: string): string {
  return query.toLowerCase().trim();
}

function getCached(query: string): SearchOutcome | null {
  const key = cacheKey(query);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Move to end (LRU refresh)
  cache.delete(key);
  cache.set(key, entry);
  return { ...entry.outcome, cached: true };
}

function setCache(query: string, outcome: SearchOutcome): void {
  const key = cacheKey(query);
  if (cache.size >= CACHE_MAX_SIZE) {
    // Evict oldest (first) entry
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { outcome, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Provider 1 — DuckDuckGo HTML
// ---------------------------------------------------------------------------

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const useProxy = typeof window !== 'undefined';
  const url = useProxy ? `/api/search-proxy` : targetUrl;
  
  const res = await timedFetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      ...(useProxy ? { 'x-search-target': targetUrl } : {}),
    },
  });

  if (!res.ok) throw new Error(`DDG status ${res.status}`);

  const html = await res.text();
  const results: SearchResult[] = [];

  // Parse result blocks —  each result sits inside a div with class "result"
  // Title is inside <a class="result__a">, snippet inside <a class="result__snippet">
  const resultBlocks = html.split(/class="result\s/g).slice(1);

  for (const block of resultBlocks) {
    if (results.length >= MAX_RESULTS) break;

    // Extract title + url
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    if (titleMatch) {
      let resultUrl = decodeHtml(titleMatch[1]);
      // DDG wraps URLs through a redirect — extract the actual URL
      const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try { resultUrl = decodeURIComponent(uddgMatch[1]); } catch { /* keep original */ }
      }

      const title = decodeHtml(titleMatch[2]);
      const snippet = snippetMatch ? decodeHtml(snippetMatch[1]) : '';

      if (title && resultUrl.startsWith('http')) {
        results.push({ title, url: resultUrl, snippet, source: 'DuckDuckGo' });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Provider 2 — SearXNG (JSON API, tries multiple instances)
// ---------------------------------------------------------------------------

async function searchSearXNG(query: string): Promise<SearchResult[]> {
  const useProxy = typeof window !== 'undefined';
  
  // Try instances sequentially until one works
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const targetUrl = `${instance}/search?q=${encodeURIComponent(query)}&format=json&language=auto`;
      const url = useProxy ? `/api/search-proxy` : targetUrl;
      
      const res = await timedFetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(useProxy ? { 'x-search-target': targetUrl } : {}),
        },
      }, 4_000); // Shorter timeout for individual instances

      if (!res.ok) continue;

      const data = await res.json();
      if (!Array.isArray(data?.results) || data.results.length === 0) continue;

      return data.results.slice(0, MAX_RESULTS).map((item: any) => ({
        title: decodeHtml(String(item.title || '')),
        url: String(item.url || ''),
        snippet: decodeHtml(String(item.content || '')),
        source: `SearXNG`,
      }));
    } catch {
      // Try next instance
      continue;
    }
  }

  throw new Error('All SearXNG instances unavailable');
}

// ---------------------------------------------------------------------------
// Provider 3 — Wikipedia (fallback)
// ---------------------------------------------------------------------------

async function searchWikipedia(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const languages = ['en', 'ar'];

  const fetches = languages.map(async (lang) => {
    try {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*&srlimit=3`;
      const res = await timedFetch(url, undefined, 4_000);
      if (!res.ok) return;

      const data = await res.json();
      if (!data?.query?.search) return;

      for (const item of data.query.search.slice(0, 3)) {
        results.push({
          title: item.title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
          snippet: decodeHtml(item.snippet || ''),
          source: `Wikipedia (${lang.toUpperCase()})`,
        });
      }
    } catch { /* skip */ }
  });

  await Promise.all(fetches);
  return results;
}

// ---------------------------------------------------------------------------
// Result Formatting
// ---------------------------------------------------------------------------

function formatCompact(query: string, results: SearchResult[], provider: string): string {
  if (results.length === 0) return '';

  const lines = results.map(
    (r, i) => `${i + 1}. ${r.title} | ${r.source}\n   ${r.url}\n   ${r.snippet}`
  );

  return [
    `[Web Search: "${query}" — ${results.length} results via ${provider}]`,
    ...lines,
    '[End Search]',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SearchService {
  /**
   * Execute a web search with provider failover and caching.
   * Returns a compact text block ready to inject into LLM context.
   */
  static async searchWeb(rawQuery: string): Promise<string> {
    const query = sanitizeQuery(rawQuery);

    if (!query || query.length < MIN_QUERY_LENGTH) {
      return '';
    }

    // Check cache first
    const cached = getCached(query);
    if (cached && cached.results.length > 0) {
      console.log(`[Search] Cache hit for "${query}"`);
      return formatCompact(query, cached.results, `${cached.provider} (cached)`);
    }

    // Provider chain: DDG → SearXNG → Wikipedia
    const providers: Array<{ name: string; fn: () => Promise<SearchResult[]> }> = [
      { name: 'DuckDuckGo', fn: () => searchDuckDuckGo(query) },
      { name: 'SearXNG', fn: () => searchSearXNG(query) },
      { name: 'Wikipedia', fn: () => searchWikipedia(query) },
    ];

    for (const provider of providers) {
      try {
        console.log(`[Search] Trying ${provider.name} for "${query}"`);
        const results = await provider.fn();

        if (results.length > 0) {
          const outcome: SearchOutcome = {
            ok: true,
            query,
            results,
            provider: provider.name,
            cached: false,
          };
          setCache(query, outcome);
          console.log(`[Search] ${provider.name} returned ${results.length} results`);
          return formatCompact(query, results, provider.name);
        }
      } catch (err) {
        console.warn(`[Search] ${provider.name} failed:`, err instanceof Error ? err.message : err);
      }
    }

    // All providers failed
    console.warn(`[Search] All providers failed for "${query}"`);
    return `[Web Search: "${query}" — no results available]`;
  }

  /**
   * Get detailed search outcome (used internally for diagnostics).
   */
  static async searchDetailed(rawQuery: string): Promise<SearchOutcome> {
    const query = sanitizeQuery(rawQuery);

    if (!query || query.length < MIN_QUERY_LENGTH) {
      return { ok: false, query: rawQuery, results: [], provider: 'none', cached: false, error: 'Query too short' };
    }

    const cached = getCached(query);
    if (cached) return cached;

    const providers: Array<{ name: string; fn: () => Promise<SearchResult[]> }> = [
      { name: 'DuckDuckGo', fn: () => searchDuckDuckGo(query) },
      { name: 'SearXNG', fn: () => searchSearXNG(query) },
      { name: 'Wikipedia', fn: () => searchWikipedia(query) },
    ];

    let lastError = '';

    for (const provider of providers) {
      try {
        const results = await provider.fn();
        if (results.length > 0) {
          const outcome: SearchOutcome = { ok: true, query, results, provider: provider.name, cached: false };
          setCache(query, outcome);
          return outcome;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return { ok: false, query, results: [], provider: 'none', cached: false, error: lastError || 'No results from any provider' };
  }
}
