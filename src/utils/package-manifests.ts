import type { DevTarget, ManifestRole, WorkspaceMode } from '../types';

export interface PackageManifestInfo {
  path: string;
  dir: string;
  lockPath: string;
  name: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  role: ManifestRole;
}

export interface DevWorkspacePlan {
  mode: WorkspaceMode;
  runTargets: PackageManifestInfo[];
  installTargets: PackageManifestInfo[];
  previewTarget: PackageManifestInfo | null;
  frontendTarget: PackageManifestInfo | null;
  backendTarget: PackageManifestInfo | null;
}

const PREFERRED_PRIMARY_DIRS = ['.', 'client', 'frontend', 'app', 'web', 'server', 'backend'];
const FRONTEND_DIR_HINTS = ['client', 'frontend', 'web', 'app'];
const BACKEND_DIR_HINTS = ['server', 'backend', 'api'];
const FRONTEND_PACKAGES = ['react', 'react-dom', 'next', 'vite', '@vitejs/plugin-react', 'vue', 'svelte'];
const BACKEND_PACKAGES = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', 'cors', 'helmet'];
const FRONTEND_SCRIPT_HINTS = ['vite', 'next dev', 'react-scripts', 'astro dev'];
const BACKEND_SCRIPT_HINTS = ['tsx', 'nodemon', 'node ', 'node:', 'nest start', 'fastify'];

function compareManifestPaths(a: string, b: string) {
  if (a === 'package.json') return -1;
  if (b === 'package.json') return 1;
  return a.localeCompare(b);
}

function getManifestDir(path: string) {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex === -1 ? '.' : path.slice(0, slashIndex);
}

function getLockPathForManifest(path: string) {
  const dir = getManifestDir(path);
  return dir === '.' ? 'package-lock.json' : `${dir}/package-lock.json`;
}

function hasAny(haystack: string, needles: string[]) {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function inferManifestRole(path: string, parsed: any): ManifestRole {
  const dir = getManifestDir(path).toLowerCase();
  const deps = {
    ...(parsed.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {}),
    ...(parsed.devDependencies && typeof parsed.devDependencies === 'object' ? parsed.devDependencies : {}),
  } as Record<string, string>;
  const scripts = parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
  const scriptText = Object.values(scripts).join(' ').toLowerCase();
  const depNames = Object.keys(deps);

  let frontendScore = 0;
  let backendScore = 0;

  if (FRONTEND_DIR_HINTS.includes(dir)) frontendScore += 2;
  if (BACKEND_DIR_HINTS.includes(dir)) backendScore += 2;
  if (depNames.some((name) => FRONTEND_PACKAGES.includes(name))) frontendScore += 3;
  if (depNames.some((name) => BACKEND_PACKAGES.includes(name))) backendScore += 3;
  if (hasAny(scriptText, FRONTEND_SCRIPT_HINTS)) frontendScore += 2;
  if (hasAny(scriptText, BACKEND_SCRIPT_HINTS)) backendScore += 2;
  if (depNames.includes('typescript') || depNames.includes('zod')) backendScore += 1;
  if (depNames.includes('tailwindcss') || depNames.includes('framer-motion')) frontendScore += 1;

  if (frontendScore === 0 && backendScore === 0) return 'unknown';
  if (frontendScore >= backendScore + 2) return 'frontend';
  if (backendScore >= frontendScore + 2) return 'backend';
  return 'unknown';
}

function parseManifest(path: string, raw: string): PackageManifestInfo | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      path,
      dir: getManifestDir(path),
      lockPath: getLockPathForManifest(path),
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : getManifestDir(path),
      dependencies: parsed.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {},
      devDependencies: parsed.devDependencies && typeof parsed.devDependencies === 'object' ? parsed.devDependencies : {},
      scripts: parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {},
      role: inferManifestRole(path, parsed),
    };
  } catch (_error) {
    return null;
  }
}

function sortManifests(manifests: PackageManifestInfo[]) {
  return [...manifests].sort((a, b) => {
    const aIndex = PREFERRED_PRIMARY_DIRS.indexOf(a.dir);
    const bIndex = PREFERRED_PRIMARY_DIRS.indexOf(b.dir);
    const normalizedAIndex = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const normalizedBIndex = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;

    if (normalizedAIndex !== normalizedBIndex) return normalizedAIndex - normalizedBIndex;
    return compareManifestPaths(a.path, b.path);
  });
}

export function getPackageManifestPaths(files: Record<string, string>) {
  return Object.keys(files)
    .filter((path) => path === 'package.json' || path.endsWith('/package.json'))
    .filter((path) => !path.includes('/node_modules/'))
    .sort(compareManifestPaths);
}

export function getPackageManifests(files: Record<string, string>): PackageManifestInfo[] {
  return getPackageManifestPaths(files)
    .map((path) => parseManifest(path, files[path]))
    .filter((manifest): manifest is PackageManifestInfo => Boolean(manifest));
}

export function getPackageManifestByPath(files: Record<string, string>, manifestPath: string) {
  return getPackageManifests(files).find((manifest) => manifest.path === manifestPath) || null;
}

export function getPrimaryPackageManifest(files: Record<string, string>) {
  const manifests = getPackageManifests(files);
  if (manifests.length === 0) return null;

  const withDevScript = manifests.filter((manifest) => typeof manifest.scripts.dev === 'string' && manifest.scripts.dev.trim());
  const candidates = withDevScript.length > 0 ? withDevScript : manifests;
  return sortManifests(candidates)[0];
}

export function getDependencySignatureForFiles(files: Record<string, string>) {
  return JSON.stringify(
    sortManifests(getPackageManifests(files)).map((manifest) => ({
      path: manifest.path,
      packageJson: files[manifest.path] || '',
      packageLock: files[manifest.lockPath] || '',
    }))
  );
}

export function applyManifestFiles(
  files: Record<string, string>,
  manifestPath: string,
  packageJson: string,
  packageLock: string | null
) {
  const lockPath = getLockPathForManifest(manifestPath);
  const nextFiles = {
    ...files,
    [manifestPath]: packageJson,
  };

  if (packageLock) {
    nextFiles[lockPath] = packageLock;
  } else {
    delete nextFiles[lockPath];
  }

  return nextFiles;
}

export function getManifestLabel(manifest: Pick<PackageManifestInfo, 'dir' | 'name' | 'role'>) {
  if (manifest.dir === '.') return manifest.name || 'root';
  return manifest.dir;
}

export function getDependenciesForManifest(files: Record<string, string>, manifestPath: string) {
  const manifest = getPackageManifestByPath(files, manifestPath);
  if (!manifest) return {};
  return manifest.dependencies;
}

export function getDevWorkspacePlan(files: Record<string, string>): DevWorkspacePlan {
  const manifests = getPackageManifests(files).filter((manifest) => typeof manifest.scripts.dev === 'string' && manifest.scripts.dev.trim());
  if (manifests.length === 0) {
    return {
      mode: 'single',
      runTargets: [],
      installTargets: [],
      previewTarget: null,
      frontendTarget: null,
      backendTarget: null,
    };
  }

  const sorted = sortManifests(manifests);
  const frontendTargets = sorted.filter((manifest) => manifest.role === 'frontend');
  const backendTargets = sorted.filter((manifest) => manifest.role === 'backend');

  if (frontendTargets.length === 1 && backendTargets.length === 1 && frontendTargets[0].path !== backendTargets[0].path) {
    return {
      mode: 'paired',
      runTargets: [backendTargets[0], frontendTargets[0]],
      installTargets: sorted,
      previewTarget: frontendTargets[0],
      frontendTarget: frontendTargets[0],
      backendTarget: backendTargets[0],
    };
  }

  const primary = sorted[0];
  const previewTarget = primary.role === 'backend' ? null : primary;

  return {
    mode: 'single',
    runTargets: [primary],
    installTargets: sorted,
    previewTarget,
    frontendTarget: primary.role === 'frontend' ? primary : null,
    backendTarget: primary.role === 'backend' ? primary : null,
  };
}

export function createDevTargets(plan: DevWorkspacePlan): DevTarget[] {
  return plan.runTargets.map((manifest) => ({
    manifestPath: manifest.path,
    label: getManifestLabel(manifest),
    dir: manifest.dir,
    role: manifest.role,
    status: 'idle',
    isPreviewTarget: plan.previewTarget?.path === manifest.path,
  }));
}
