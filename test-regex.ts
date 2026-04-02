const input = '"ابحث عن احدث نماذج AI coding في 2026"';
const isQuestionOrResearch = /^\W*(what|how|why|when|where|who|explain|tell me|search|research|ما|كيف|لماذا|متى|اين|من|اشرح|قل لي|ابحث|بحث|هل)/i.test(input.trim());
console.log("With \\W*:", isQuestionOrResearch);

const improvedRegex = /^[^a-zA-Z0-9\u0600-\u06FF]*(what|how|why|when|where|who|explain|tell me|search|research|ما|كيف|لماذا|متى|اين|من|اشرح|قل لي|ابحث|بحث|هل)/i.test(input.trim());
console.log("With proper exclusion:", improvedRegex);
