import type { BuildSpec, ExecutionMode, GateResult, GenerationSummary, WorkflowKind } from '../types';

const PLAN_FILES = ['implementation.md', 'structure.md', 'task.md'] as const;
const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|json|css|scss|html)$/;
const COMPILABLE_SOURCE_PATTERN = /\.(ts|tsx|js|jsx)$/;

interface ParsedTaskEntry {
  title: string;
  files: string[];
}

interface QualityGateOptions {
  executionMode?: ExecutionMode;
  requirePlanArtifacts?: boolean;
}

interface GenerationSummaryOptions {
  executionMode?: ExecutionMode;
  planArtifactsCreated?: boolean;
  workflow?: WorkflowKind;
  plannerUsed?: boolean;
}

interface StaticCompileIssue {
  path: string;
  message: string;
}

function hasFile(files: Record<string, string>, path: string) {
  return Object.prototype.hasOwnProperty.call(files, path);
}

function parsePackageJson(files: Record<string, string>) {
  const raw = files['package.json'];
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function pushIf(condition: boolean, results: GateResult[], gate: GateResult) {
  if (condition) results.push(gate);
}

function parseRequiredFiles(structureContent: string) {
  return Array.from(
    new Set(
      structureContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          const bulletMatch = line.match(/^[-*]\s+`?([^`]+)`?$/);
          if (bulletMatch) return [bulletMatch[1]];

          const treeMatch = line.match(/(?:[|`├└─\s])+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)$/);
          if (treeMatch) return [treeMatch[1]];

          return Array.from(line.matchAll(/`([^`]+\.[A-Za-z0-9]+)`/g)).map((match) => match[1]);
        })
        .filter((candidate) => !candidate.endsWith('/'))
    )
  );
}

function parseTaskEntries(taskContent: string) {
  const lines = taskContent.split(/\r?\n/);
  const entries: ParsedTaskEntry[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const taskMatch = lines[i].match(/^- \[[ xX~]\] (.+)$/);
    if (!taskMatch) continue;

    const files: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (/^- \[[ xX~]\] /.test(line.trim()) || /^#{1,6}\s/.test(line.trim())) break;

      const fileMatch = line.match(/^\s*- \[[ xX~]\] `([^`]+)`/);
      if (fileMatch) files.push(fileMatch[1]);
    }

    entries.push({ title: taskMatch[1].trim(), files });
  }

  return entries;
}

function hasImplementationSections(content: string) {
  return ['# Implementation Plan', '## Goals', '## Architecture', '## Acceptance Criteria'].every((section) =>
    content.includes(section)
  );
}

function getFilesWithMarkdownFences(files: Record<string, string>) {
  return Object.entries(files)
    .filter(([path, content]) => SOURCE_FILE_PATTERN.test(path) && content.includes('```'))
    .map(([path]) => path);
}

function hasSuspiciousQuoteTermination(line: string) {
  return /:\s*'[^'\\]*(?:\\.[^'\\]*)*'[^,}\]\n]+/.test(line) || /:\s*"[^"\\]*(?:\\.[^"\\]*)*"[^,}\]\n]+/.test(line);
}

function getStaticCompileIssues(files: Record<string, string>) {
  const issues: StaticCompileIssue[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.json')) {
      try {
        JSON.parse(content);
      } catch (error) {
        issues.push({
          path,
          message: error instanceof Error ? error.message : 'Invalid JSON syntax',
        });
      }
      continue;
    }

    if (!COMPILABLE_SOURCE_PATTERN.test(path)) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (hasSuspiciousQuoteTermination(line)) {
        issues.push({
          path,
          message: `Suspicious string termination near line ${index + 1}`,
        });
      }
    });
  }

  return issues;
}

function createGate(gate: GateResult): GateResult {
  return gate;
}

export async function runQualityGates(
  files: Record<string, string>,
  spec: BuildSpec,
  options: QualityGateOptions = {}
): Promise<GateResult[]> {
  const results: GateResult[] = [];
  const executionMode = options.executionMode ?? 'multi-agent';
  const requirePlanArtifacts = options.requirePlanArtifacts ?? executionMode === 'multi-agent';
  const packageJson = parsePackageJson(files);
  const fileKeys = Object.keys(files);
  const hasServerFiles = fileKeys.some((file) =>
    file.startsWith('server/') || file.startsWith('api/') || file === 'server.ts' || file === 'server.js'
  );
  const hasFrontendFiles = fileKeys.some((file) => file.startsWith('src/'));
  const hasEnvSecretsInClient = Object.entries(files).some(([path, content]) =>
    path.startsWith('src/') && /(SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9_-]+)/.test(content)
  );
  const implementationContent = files['implementation.md'] || '';
  const structureContent = files['structure.md'] || '';
  const taskContent = files['task.md'] || '';
  const structureRequiredFiles = parseRequiredFiles(structureContent);
  const taskEntries = parseTaskEntries(taskContent);
  const taskFiles = Array.from(new Set(taskEntries.flatMap((entry) => entry.files)));
  const missingPlannedFiles = structureRequiredFiles.filter((file) => !hasFile(files, file));
  const untrackedStructureFiles = structureRequiredFiles.filter((file) => !taskFiles.includes(file));
  const tasksWithoutFiles = taskEntries.filter((entry) => entry.files.length === 0).map((entry) => entry.title);
  const filesWithMarkdownFences = getFilesWithMarkdownFences(files);
  const staticCompileIssues = getStaticCompileIssues(files);

  if (requirePlanArtifacts) {
    pushIf(!PLAN_FILES.every((file) => hasFile(files, file)), results, createGate({
      id: 'plan-files-present',
      status: 'fail',
      priority: 'compliance',
      scope: 'universal',
      title: 'Missing plan artifacts',
      message: 'implementation.md, structure.md, and task.md must all exist before the generation result can be accepted.',
      affectedFiles: [...PLAN_FILES],
      autoFixHint: 'Generate the three planning artifacts before building the project.',
    }));

    pushIf(Boolean(implementationContent) && !hasImplementationSections(implementationContent), results, createGate({
      id: 'implementation-plan-shape',
      status: 'fail',
      priority: 'compliance',
      scope: 'universal',
      title: 'implementation.md is incomplete',
      message: 'implementation.md must include goals, architecture, and acceptance criteria sections.',
      affectedFiles: ['implementation.md'],
      autoFixHint: 'Rewrite implementation.md using the required section headings.',
    }));

    pushIf(Boolean(taskContent) && taskEntries.length < 3, results, createGate({
      id: 'task-plan-steps',
      status: 'fail',
      priority: 'compliance',
      scope: 'universal',
      title: 'task.md lacks executable tasks',
      message: 'task.md must contain at least three structured top-level tasks.',
      affectedFiles: ['task.md'],
      autoFixHint: 'Expand task.md into concrete implementation tasks.',
    }));

    pushIf(tasksWithoutFiles.length > 0, results, createGate({
      id: 'task-files-mapping',
      status: 'warn',
      priority: 'quality',
      scope: 'universal',
      title: 'Some tasks are not mapped to files',
      message: `Every task must list its target files. Missing file mapping for: ${tasksWithoutFiles.join(', ')}.`,
      affectedFiles: ['task.md'],
      autoFixHint: 'Add file checklist items under every task in task.md.',
    }));

    pushIf(Boolean(structureContent) && structureRequiredFiles.length === 0, results, createGate({
      id: 'structure-required-files',
      status: 'fail',
      priority: 'compliance',
      scope: 'universal',
      title: 'structure.md does not define required files',
      message: 'structure.md must describe the intended project structure and list concrete files.',
      affectedFiles: ['structure.md'],
      autoFixHint: 'Add a file tree or a Required Files section with concrete paths.',
    }));

    pushIf(untrackedStructureFiles.length > 0, results, createGate({
      id: 'task-structure-coverage',
      status: 'warn',
      priority: 'quality',
      scope: 'universal',
      title: 'task.md does not cover all planned files',
      message: `These planned files are missing from task.md: ${untrackedStructureFiles.join(', ')}.`,
      affectedFiles: ['task.md', 'structure.md'],
      autoFixHint: 'Ensure every planned implementation file appears under exactly one task in task.md.',
    }));

    pushIf(missingPlannedFiles.length > 0, results, createGate({
      id: 'structure-plan-compliance',
      status: 'fail',
      priority: 'compliance',
      scope: 'universal',
      title: 'Generated files do not match structure.md',
      message: `The generated project is missing planned files: ${missingPlannedFiles.join(', ')}.`,
      affectedFiles: ['structure.md', ...missingPlannedFiles],
      autoFixHint: 'Create the missing files or update structure.md so it matches the intended build.',
    }));
  }

  pushIf(!packageJson, results, createGate({
    id: 'package-json-valid',
    status: 'fail',
    priority: 'blocker',
    scope: 'universal',
    title: 'Package manifest missing or invalid',
    message: 'package.json must exist and be valid JSON before the generation result can be accepted.',
    affectedFiles: ['package.json'],
    autoFixHint: 'Create or repair package.json with coherent scripts and dependencies.',
  }));

  pushIf(Boolean(packageJson && !packageJson.scripts?.dev), results, createGate({
    id: 'dev-script',
    status: 'fail',
    priority: 'blocker',
    scope: 'universal',
    title: 'Missing development script',
    message: 'Generated projects must define a dev script so the preview environment can start consistently.',
    affectedFiles: ['package.json'],
    autoFixHint: 'Add a valid dev script for the generated app kind.',
  }));

  pushIf(hasEnvSecretsInClient, results, createGate({
    id: 'client-secret-leak',
    status: 'fail',
    priority: 'blocker',
    scope: 'universal',
    title: 'Server secret leaked into client code',
    message: 'Privileged secrets were found in client-side source files. They must move to env placeholders or trusted server code.',
    affectedFiles: fileKeys.filter((file) => file.startsWith('src/')),
    autoFixHint: 'Remove server-only secrets from client files and use env placeholders instead.',
  }));

  pushIf(filesWithMarkdownFences.length > 0, results, createGate({
    id: 'source-markdown-fences',
    status: 'fail',
    priority: 'blocker',
    scope: 'universal',
    title: 'Generated source file contains markdown fences',
    message: `These implementation files still contain markdown code fences and are likely malformed: ${filesWithMarkdownFences.join(', ')}.`,
    affectedFiles: filesWithMarkdownFences,
    autoFixHint: 'Rewrite the affected source files without markdown fences or chat formatting markers.',
  }));

  pushIf(staticCompileIssues.length > 0, results, createGate({
    id: 'static-compile-errors',
    status: 'fail',
    priority: 'blocker',
    scope: 'universal',
    title: 'Static compile errors detected',
    message: `Detected browser-safe parser/build issues: ${staticCompileIssues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join(' | ')}.`,
    affectedFiles: Array.from(new Set(staticCompileIssues.map((issue) => issue.path))),
    autoFixHint: 'Fix the syntax or string termination issues in the affected files before runtime validation.',
  }));

  if (spec.appKind === 'frontend') {
    pushIf(!hasFrontendFiles, results, createGate({
      id: 'frontend-src-present',
      status: 'fail',
      priority: 'blocker',
      scope: 'frontend',
      title: 'Missing frontend source tree',
      message: 'Frontend generation must include a src/ application tree.',
      affectedFiles: [],
      autoFixHint: 'Generate the frontend source tree starting from src/App.tsx and src/index.tsx.',
    }));

    pushIf(!hasFile(files, 'src/App.tsx'), results, createGate({
      id: 'frontend-app-entry',
      status: 'fail',
      priority: 'blocker',
      scope: 'frontend',
      title: 'Missing App entry',
      message: 'Frontend output must include src/App.tsx.',
      affectedFiles: ['src/App.tsx'],
      autoFixHint: 'Add src/App.tsx and wire it from the entry file.',
    }));

    pushIf(!hasFile(files, 'src/index.tsx') && !hasFile(files, 'src/main.tsx'), results, createGate({
      id: 'frontend-root-entry',
      status: 'fail',
      priority: 'blocker',
      scope: 'frontend',
      title: 'Missing root entry file',
      message: 'Frontend output must include a root React entrypoint.',
      affectedFiles: ['src/index.tsx'],
      autoFixHint: 'Add a React entrypoint that mounts the app.',
    }));

    pushIf(!fileKeys.some((file) => file.includes('components') || file.includes('pages')), results, createGate({
      id: 'frontend-structure-depth',
      status: 'warn',
      priority: 'quality',
      scope: 'frontend',
      title: 'Flat frontend structure',
      message: 'The generated UI is very flat. Prefer at least one feature or component grouping for maintainability.',
      affectedFiles: ['src/App.tsx'],
    }));
  }

  if (spec.appKind === 'backend') {
    pushIf(!hasServerFiles, results, createGate({
      id: 'backend-server-present',
      status: 'fail',
      priority: 'blocker',
      scope: 'backend',
      title: 'Missing backend entry',
      message: 'Backend generation must include a server entrypoint.',
      affectedFiles: ['server/index.ts'],
      autoFixHint: 'Generate a server entrypoint and wire scripts to it.',
    }));

    pushIf(Boolean(packageJson && !String(packageJson.scripts?.dev || '').includes('server') && !String(packageJson.scripts?.dev || '').includes('tsx')), results, createGate({
      id: 'backend-dev-script-shape',
      status: 'warn',
      priority: 'quality',
      scope: 'backend',
      title: 'Backend dev script is unusual',
      message: 'The dev script does not clearly start the backend runtime. Verify the generated server workflow.',
      affectedFiles: ['package.json'],
    }));
  }

  if (spec.appKind === 'full-stack') {
    pushIf(!hasServerFiles || !hasFrontendFiles, results, createGate({
      id: 'fullstack-sides-present',
      status: 'fail',
      priority: 'blocker',
      scope: 'full-stack',
      title: 'Incomplete full-stack structure',
      message: 'Full-stack generation must include both client and server sides.',
      affectedFiles: ['src/App.tsx', 'server/index.ts'],
      autoFixHint: 'Generate both frontend and backend layers and wire them together.',
    }));

    pushIf(Boolean(packageJson && !String(packageJson.scripts?.dev || '').includes('concurrently')), results, createGate({
      id: 'fullstack-dev-orchestration',
      status: 'warn',
      priority: 'quality',
      scope: 'full-stack',
      title: 'Full-stack dev workflow is not explicit',
      message: 'Full-stack projects should expose a development script that clearly orchestrates client and server.',
      affectedFiles: ['package.json'],
    }));

    pushIf(!fileKeys.some((file) => file.startsWith('server/routes/') || file.startsWith('server/controllers/')), results, createGate({
      id: 'fullstack-server-separation',
      status: 'warn',
      priority: 'quality',
      scope: 'full-stack',
      title: 'Server structure is thin',
      message: 'The backend exists but lacks route/controller separation expected from professional full-stack output.',
      affectedFiles: ['server/index.ts'],
    }));
  }

  pushIf(fileKeys.length <= 6, results, createGate({
    id: 'output-too-small',
    status: 'warn',
    priority: 'quality',
    scope: spec.appKind,
    title: 'Generated output is unusually small',
    message: 'The file set is too small for a polished result. The build may still work, but quality is likely below target.',
    affectedFiles: fileKeys,
  }));

  if (results.length === 0) {
    results.push(createGate({
      id: 'all-gates-passed',
      status: 'pass',
      priority: 'quality',
      scope: 'universal',
      title: 'Quality gates passed',
      message: 'The generation result passed the configured balanced quality gates.',
      affectedFiles: [],
    }));
  }

  return results;
}

export function summarizeGateResults(
  spec: BuildSpec,
  gateResults: GateResult[],
  reviewerSummary: string,
  attemptCount: number,
  options: GenerationSummaryOptions = {}
): GenerationSummary {
  const executionMode = options.executionMode ?? 'multi-agent';
  const workflow = options.workflow ?? 'build';
  const plannerUsed = options.plannerUsed ?? false;
  const passed = gateResults.filter((gate) => gate.status === 'pass').length;
  const warnings = gateResults.filter((gate) => gate.status === 'warn').length;
  const failed = gateResults.filter((gate) => gate.status === 'fail').length;
  const blockerFailures = gateResults.filter((gate) => gate.status === 'fail' && gate.priority === 'blocker').length;
  const complianceFailures = gateResults.filter((gate) => gate.status === 'fail' && gate.priority === 'compliance').length;
  const qualityWarnings = gateResults.filter((gate) => gate.status === 'warn' && gate.priority === 'quality').length;
  const planCompliancePassed = !options.planArtifactsCreated
    ? true
    : gateResults.filter((gate) => gate.priority === 'compliance').every((gate) => gate.status !== 'fail');

  return {
    appKind: spec.appKind,
    executionMode,
    workflow,
    plannerUsed,
    attemptCount,
    passed,
    warnings,
    failed,
    blockerFailures,
    complianceFailures,
    qualityWarnings,
    reviewerSummary,
    planArtifactsCreated: options.planArtifactsCreated ?? executionMode === 'multi-agent',
    planCompliancePassed,
    runtimeValidated: false,
    runtimeFailures: 0,
    previewBootPassed: false,
    requestResolved: blockerFailures === 0,
    projectClean: failed === 0,
  };
}

const PRIORITY_LABELS = {
  blocker: 'Blocker',
  compliance: 'Compliance',
  quality: 'Quality',
} as const;

export function getFailedGateSummary(gateResults: GateResult[]) {
  return gateResults
    .filter((gate) => gate.status === 'fail')
    .sort((left, right) => {
      const priorityOrder = { blocker: 0, compliance: 1, quality: 2 };
      return priorityOrder[left.priority] - priorityOrder[right.priority];
    })
    .map((gate) => `- [${PRIORITY_LABELS[gate.priority]}] ${gate.title}: ${gate.message}${gate.autoFixHint ? ` Fix hint: ${gate.autoFixHint}` : ''}`)
    .join('\n');
}
