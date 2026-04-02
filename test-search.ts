import { SearchService } from './src/services/SearchService.ts';

function extractSearchKeywords(input: string): string {
  return input
    .replace(/--- FILE:[\s\S]*?--- END FILE ---/g, ' ')
    .replace(/<file[\s\S]*?<\/file>/g, ' ')
    .replace(/<edit[\s\S]*?<\/edit>/g, ' ')
    .replace(/\b(what|how|why|when|where|who|explain|tell me|search|research|ما|كيف|لماذا|متى|اين|من|اشرح|قل لي|ابحث|عن|بحث|هل|please|can you|i want|i need|make me|create|build|generate|اعمل|عايز|محتاج|ممكن)\b/gi, ' ')
    .replace(/["']/g, '') // Remove quotes to avoid exact string matching which yields 0 results
    .replace(/[<>{}[\]`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function testFullFlow() {
  const input = '"ابحث عن احدث نماذج AI coding في 2026"';
  console.log('Original input:', input);
  
  const query = extractSearchKeywords(input);
  console.log('Extracted query:', query);
  
  if (query.length < 3) {
    console.log('Query too short to search.');
    return;
  }
  
  console.log('Testing SearchService with extracted query...');
  const res = await SearchService.searchWeb(query);
  console.log('RESULT preview (first 500 chars):\n', res.substring(0, 500));
}

testFullFlow();
