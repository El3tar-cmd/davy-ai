import type { AppKind, BuildSpec, ProjectIntent, RepairStrategy, TargetSurface } from '../types';

function normalizeInput(input: string) {
  return input.toLowerCase();
}

function getFileKeys(existingFiles: Record<string, string>) {
  return Object.keys(existingFiles).filter((file) => !file.endsWith('.md'));
}

function detectCurrentSurface(existingFiles: Record<string, string>): TargetSurface {
  const fileKeys = getFileKeys(existingFiles);
  const hasFrontendFiles = fileKeys.some((file) => file.startsWith('src/') || file === 'index.html');
  const hasServerFiles = fileKeys.some((file) =>
    file.startsWith('server/') || file.startsWith('api/') || file === 'server.ts' || file === 'server.js'
  );

  if (hasFrontendFiles && hasServerFiles) return 'full-stack';
  if (hasServerFiles) return 'backend';
  if (hasFrontendFiles) return 'frontend';
  return 'mixed';
}

export function classifyAppKind(input: string, existingFiles: Record<string, string>): AppKind {
  const normalized = normalizeInput(input);
  const currentSurface = detectCurrentSurface(existingFiles);

  const asksForBackend = /(backend|api|server|database|auth|admin|dashboard data|rest|endpoint|express|full[ -]?stack)/.test(normalized);
  const asksForFrontendOnly = /(landing page|ui|ux|hero section|frontend|website|portfolio|marketing)/.test(normalized);

  if (currentSurface === 'full-stack') return 'full-stack';
  if (currentSurface === 'backend' && !asksForFrontendOnly) return 'backend';
  if (currentSurface === 'frontend' && !asksForBackend) return 'frontend';

  if (asksForBackend || currentSurface === 'backend') {
    if (/(landing|dashboard|react|frontend|page|client|website|app)/.test(normalized) || currentSurface === 'frontend') {
      return 'full-stack';
    }
    return 'backend';
  }

  return 'frontend';
}

function inferProjectIntent(input: string, existingFiles: Record<string, string>): ProjectIntent {
  const normalized = normalizeInput(input);
  const fileKeys = getFileKeys(existingFiles);

  if (/(from scratch|start over|rebuild|regenerate|rewrite everything)/.test(normalized)) {
    return 'create';
  }

  return fileKeys.length > 2 ? 'modify' : 'create';
}

function inferRepairStrategy(input: string, projectIntent: ProjectIntent): RepairStrategy {
  const normalized = normalizeInput(input);

  if (projectIntent === 'modify') {
    return /(refactor|overhaul|rewrite|restructure)/.test(normalized) ? 'scoped-rewrite' : 'minimal-edit';
  }

  return /(preserve|patch|fix|repair)/.test(normalized) ? 'minimal-edit' : 'scoped-rewrite';
}

export function buildSpecFromPrompt(input: string, existingFiles: Record<string, string>, plannerNotes: string): BuildSpec {
  const appKind = classifyAppKind(input, existingFiles);
  const normalized = normalizeInput(input);
  const currentSurface = detectCurrentSurface(existingFiles);
  const projectIntent = inferProjectIntent(input, existingFiles);
  const repairStrategy = inferRepairStrategy(input, projectIntent);

  const uiStyle = normalized.includes('dashboard')
    ? 'dashboard'
    : normalized.includes('landing') || normalized.includes('website')
      ? 'marketing'
      : normalized.includes('admin')
        ? 'enterprise'
        : 'modern-product';

  const featureSet = [
    normalized.includes('auth') ? 'authentication' : '',
    normalized.includes('search') ? 'search' : '',
    normalized.includes('upload') ? 'file-upload' : '',
    normalized.includes('database') ? 'database' : '',
    normalized.includes('dashboard') ? 'dashboard' : '',
    normalized.includes('chat') ? 'chat' : '',
  ].filter(Boolean);

  const dataRequirements = [
    appKind !== 'frontend' ? 'validated-server-boundaries' : '',
    normalized.includes('database') ? 'persistent-data-layer' : '',
    normalized.includes('auth') ? 'authenticated-user-flow' : '',
  ].filter(Boolean);

  const requiredFiles = [
    'src/App.tsx',
    appKind !== 'backend' ? 'src/index.tsx' : '',
    appKind !== 'frontend' ? 'server/index.ts' : '',
  ].filter(Boolean);

  const acceptanceChecks = [
    'No broken imports or unresolved local file references',
    'Project structure must match the selected app kind',
    appKind !== 'frontend' ? 'Server entry and API wiring must be coherent' : 'UI must be responsive and componentized',
    projectIntent === 'modify' ? 'Preserve unrelated working files unless change is required' : 'Create a coherent runnable project from the prompt',
  ];

  return {
    appKind,
    featureSet,
    uiStyle,
    dataRequirements,
    requiredFiles,
    acceptanceChecks,
    plannerNotes,
    planArtifacts: {
      implementation: 'implementation.md',
      structure: 'structure.md',
      task: 'task.md',
    },
    projectIntent,
    targetSurface: currentSurface,
    repairStrategy,
  };
}
