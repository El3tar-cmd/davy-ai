// SearchService.ts
export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  source?: string;
}

const SEARCH_TIMEOUT_MS = 8000;
const MAX_RESULTS_PER_SOURCE = 5;

function sanitizeSearchQuery(query: string) {
  return query
    .replace(/--- FILE:[\s\S]*?--- END FILE ---/g, ' ')
    .replace(/<file[\s\S]*?<\/file>/g, ' ')
    .replace(/<edit[\s\S]*?<\/edit>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export class SearchService {
  static async searchWeb(query: string): Promise<string> {
    const safeQuery = sanitizeSearchQuery(query);
    console.log(`[SearchService] Executing privacy-safe search for: "${safeQuery}"`);

    if (!safeQuery) {
      return this.formatError('Empty query provided.');
    }

    try {
      const combinedResults = await this.searchWikipedia(safeQuery).catch((err) => {
        console.warn('[SearchService] Wikipedia failed:', err);
        return [] as SearchResult[];
      });

      if (combinedResults.length > 0) {
        return this.formatResults(safeQuery, combinedResults);
      }

      return this.formatError(`No relevant results found for "${safeQuery}".`);
    } catch (error: any) {
      console.error('[SearchService] Fatal error:', error);
      return this.formatError(`Search failed: ${error.message || 'Unknown error'}`);
    }
  }

  private static async searchWikipedia(query: string): Promise<SearchResult[]> {
    const languages = ['en', 'ar'];
    const results: SearchResult[] = [];

    await Promise.all(languages.map(async (lang) => {
      try {
        const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) return;

        const data = await response.json();
        if (data?.query?.search) {
          const langResults = data.query.search.slice(0, MAX_RESULTS_PER_SOURCE).map((item: any) => ({
            title: item.title,
            link: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
            snippet: item.snippet.replace(/<\/?[^>]+(>|$)/g, ''),
            source: `Wikipedia (${lang.toUpperCase()})`,
          }));
          results.push(...langResults);
        }
      } catch (e) {
        console.warn(`[SearchService] Wikipedia (${lang}) failed:`, e);
      }
    }));

    return results;
  }

  private static formatResults(query: string, results: SearchResult[]): string {
    let output = `
--- LIVE WEB INTELLIGENCE: SEARCH RESULTS ---
`;
    output += `Query: "${query}"
`;
    output += `Timestamp: ${new Date().toLocaleString()}

`;

    results.forEach((r, i) => {
      output += `[RESULT ${i + 1}]
`;
      output += `TITLE: ${r.title}
`;
      output += `SOURCE: ${r.source}
`;
      output += `URL: ${r.link}
`;
      output += `SUMMARY: ${r.snippet}

`;
    });

    output += `--- END OF SEARCH DATA ---
`;
    output += `INSTRUCTIONS: Use the real-time data above to provide an accurate, up-to-date response. If the data contradicts your internal knowledge, prioritize the search results.
`;
    return output;
  }

  private static formatError(message: string): string {
    return `
--- WEB SEARCH UNAVAILABLE ---
Reason: ${message}
INSTRUCTIONS: Proceed using your internal knowledge base, but mention that live search was unsuccessful.
`;
  }
}
