import { DEFAULT_FILES } from '../constants/default-files';

export interface EditApplicationResult {
  filePath: string;
  search: string;
  applied: boolean;
}

export interface ParserDiagnostics {
  failedEditCount: number;
  failedEditFiles: string[];
  overwrittenExistingFiles: string[];
  editResults: EditApplicationResult[];
}

/**
 * Parse <file path="...">...</file> and <edit file="..."> tags from AI-generated text.
 * Returns extracted new/patched files and cleaned text (without file/edit blocks).
 */
export function parseFilesFromStream(
  text: string,
  baselineFiles: Record<string, string> = {}
): {
  files: Record<string, string>;
  cleanText: string;
  diagnostics: ParserDiagnostics;
} {
  const files: Record<string, string> = {};
  const overwrittenExistingFiles = new Set<string>();
  const editResults: EditApplicationResult[] = [];

  const closedFileBlocks = Array.from(text.matchAll(/<file path="([^"]+)">([\s\S]*?)<\/file>/g));
  const closedEditBlocks = Array.from(text.matchAll(/<edit file="([^"]+)">([\s\S]*?)<\/edit>/g));
  let cleanText = text;

  for (const match of closedFileBlocks) {
    const [, filePath, content] = match;
    if (filePath in baselineFiles) {
      overwrittenExistingFiles.add(filePath);
    }
    files[filePath] = content;
    cleanText = cleanText.replace(match[0], '');
  }

  for (const match of closedEditBlocks) {
    const [, filePath, editContent] = match;
    let patchedContent = files[filePath] ?? baselineFiles[filePath] ?? '';

    for (const blockMatch of editContent.matchAll(/<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>/g)) {
      const searchStr = blockMatch[1].trim();
      const replaceStr = blockMatch[2];

      if (!searchStr) {
        continue;
      }

      const result = fuzzyReplace(patchedContent, searchStr, replaceStr);
      patchedContent = result.content;
      editResults.push({ filePath, search: searchStr, applied: result.applied });
    }

    files[filePath] = patchedContent;
    cleanText = cleanText.replace(match[0], '');
  }

  cleanText = stripIncompleteGenerationBlocks(cleanText);

  const failedEditFiles = Array.from(new Set(editResults.filter((result) => !result.applied).map((result) => result.filePath)));

  return {
    files,
    cleanText: cleanText.trim(),
    diagnostics: {
      failedEditCount: editResults.filter((result) => !result.applied).length,
      failedEditFiles,
      overwrittenExistingFiles: Array.from(overwrittenExistingFiles),
      editResults,
    },
  };
}

function stripIncompleteGenerationBlocks(text: string) {
  return stripDanglingTagContent(stripDanglingTagContent(text, '<file path="', '</file>'), '<edit file="', '</edit>');
}

function stripDanglingTagContent(text: string, openTagPrefix: string, closeTag: string) {
  const lastOpenIndex = text.lastIndexOf(openTagPrefix);
  if (lastOpenIndex === -1) return text;

  const closingIndex = text.indexOf(closeTag, lastOpenIndex + openTagPrefix.length);
  if (closingIndex !== -1) return text;

  return text.slice(0, lastOpenIndex).trimEnd();
}

/**
 * Attempts to replace a search string in content, falling back to flexible whitespace matching if exact match fails.
 */
function fuzzyReplace(content: string, search: string, replace: string): { content: string; applied: boolean } {
  if (content.includes(search)) {
    return { content: content.replace(search, replace), applied: true };
  }

  const normalizedSearch = search.replace(/\r\n/g, '\n').trim();
  if (content.includes(normalizedSearch)) {
    return { content: content.replace(normalizedSearch, replace), applied: true };
  }

  try {
    const escapedSearch = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexibleSearchRegex = new RegExp(escapedSearch.replace(/\s+/g, '\\s+'), 'g');

    const match = flexibleSearchRegex.exec(content);
    if (match) {
      return {
        content: content.substring(0, match.index) + replace + content.substring(match.index + match[0].length),
        applied: true,
      };
    }
  } catch (error) {
    console.warn('[FileParser] Regex creation failed for fuzzy replace', error);
  }

  console.warn('[FileParser] Failed to apply patch. Search block not found.');
  return { content, applied: false };
}

/**
 * Merge user files with default files and normalize for WebContainer consumption.
 * Handles alternative entry points, package.json normalization, etc.
 */
export function getWebContainerFiles(
  userFiles: Record<string, string>,
  defaultFiles: Record<string, string> = DEFAULT_FILES
): Record<string, string> {
  const merged: Record<string, string> = { ...defaultFiles, ...userFiles };

  if (merged['public/index.html']) {
    merged['index.html'] = merged['public/index.html'];
    delete merged['public/index.html'];
  }

  const hasMainJsx = 'src/main.jsx' in userFiles;
  const hasMainTsx = 'src/main.tsx' in userFiles;
  const hasIndexJsx = 'src/index.jsx' in userFiles;
  const entryFile = hasMainTsx
    ? 'src/main.tsx'
    : hasMainJsx
      ? 'src/main.jsx'
      : hasIndexJsx
        ? 'src/index.jsx'
        : 'src/index.tsx';

  if (hasMainJsx || hasMainTsx || hasIndexJsx) {
    if (!('src/index.tsx' in userFiles)) {
      delete merged['src/index.tsx'];
    }
  }

  if (merged['package.json']) {
    try {
      const pkg = JSON.parse(merged['package.json']);
      pkg.type = 'module';
      merged['package.json'] = JSON.stringify(pkg, null, 2);
    } catch (error) {
      console.error('Failed to parse package.json', error);
    }
  } else {
    merged['package.json'] = JSON.stringify(
      {
        name: 'react-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        main: entryFile,
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
          'react-router-dom': '^6.22.3',
        },
        devDependencies: {
          typescript: '^4.9.3',
          vite: '^5.2.0',
          '@vitejs/plugin-react': '^4.2.1',
        },
      },
      null,
      2
    );
  }

  if (merged['index.html']) {
    const sandboxObserverScript = `
    <script>
      const PARENT_ORIGIN = (() => {
        try {
          return document.referrer ? new URL(document.referrer).origin : null;
        } catch (_error) {
          return null;
        }
      })();
      window.addEventListener('click', (e) => {
        if (e.altKey && PARENT_ORIGIN) {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target;
          window.parent.postMessage({
            type: 'CLICK_TO_EDIT',
            tagName: target.tagName.toLowerCase(),
            className: typeof target.className === 'string' ? target.className : (target.className?.baseVal || ''),
            text: target.innerText ? target.innerText.substring(0, 60) : '',
            id: target.id
          }, PARENT_ORIGIN);

          const originalOutline = target.style.outline;
          target.style.outline = '3px solid #6366f1';
          target.style.transition = 'outline 0.3s ease';
          setTimeout(() => { target.style.outline = originalOutline; }, 500);
        }
      }, { capture: true });

      const sendErrorToAgent = (source, msg, file, line) => {
        if (!PARENT_ORIGIN) return;
        window.parent.postMessage({
          type: 'RUNTIME_ERROR',
          payload: \`[Sandbox Error] \${source}: \${msg} \${file ? 'at '+file+':'+line : ''}\`
        }, PARENT_ORIGIN);
      };

      window.addEventListener('error', (e) => sendErrorToAgent('Window', e.message, e.filename, e.lineno));
      window.addEventListener('unhandledrejection', (e) => sendErrorToAgent('Promise', e.reason?.message || e.reason));

      const origError = console.error;
      console.error = function(...args) {
        origError.apply(console, args);
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        if (!msg.includes('Warning:')) {
          sendErrorToAgent('Console', msg);
        }
      };

      window.addEventListener('message', (e) => {
        if (PARENT_ORIGIN && e.origin === PARENT_ORIGIN && e.source === window.parent && e.data && e.data.type === 'REQUEST_DOM_SNAPSHOT') {
          const clone = document.documentElement.cloneNode(true);
          clone.querySelectorAll('script, style, link, meta, noscript').forEach(el => el.remove());

          const html = clone.innerHTML.replace(/ class="([^"]*)"/g, (match, classes) => {
            const clean = classes.split(' ').filter(c => !c.startsWith('hover:') && !c.startsWith('focus:') && !c.startsWith('sm:') && !c.startsWith('md:') && !c.startsWith('lg:') && !c.startsWith('transition')).join(' ');
            return clean ? \` class="\${clean}"\` : '';
          });

          window.parent.postMessage({
            type: 'DOM_SNAPSHOT',
            payload: html.substring(0, 8000)
          }, PARENT_ORIGIN);
        }
      });
    </script>
    `;
    merged['index.html'] = merged['index.html'].replace('</body>', `${sandboxObserverScript}\n  </body>`);

    if (merged['index.html'].match(/<script[^>]*src="\/src\/[^"]+"[^>]*><\/script>/)) {
      merged['index.html'] = merged['index.html'].replace(
        /<script[^>]*src="\/src\/[^"]+"[^>]*><\/script>/,
        `<script type="module" src="/${entryFile}"></script>`
      );
    } else if (!merged['index.html'].includes('src/')) {
      merged['index.html'] = merged['index.html'].replace(
        '</body>',
        `  <script type="module" src="/${entryFile}"></script>\n  </body>`
      );
    }
  }

  if ('src/App.jsx' in userFiles && !('src/App.tsx' in userFiles)) {
    delete merged['src/App.tsx'];
  }

  if (!merged['vite.config.ts'] && !merged['vite.config.js']) {
    merged['vite.config.ts'] = `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});`;
  }

  return merged;
}
