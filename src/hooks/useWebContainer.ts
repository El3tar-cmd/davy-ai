import { useState, useEffect, useCallback, useRef } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { getWebContainerFiles } from '../utils/file-parser';
import {
  applyManifestFiles,
  createDevTargets,
  getDependencySignatureForFiles,
  getDevWorkspacePlan,
  getManifestLabel,
  getPackageManifestByPath,
  getPackageManifests,
  getPrimaryPackageManifest,
  type DevWorkspacePlan,
  type PackageManifestInfo,
} from '../utils/package-manifests';
import type { ActiveTab, BootPhase, DeviceSize, DevTarget, WorkspaceMode } from '../types';

interface UseWebContainerOptions {
  files: Record<string, string>;
  isGenerating: boolean;
  onFilesChange?: (files: Record<string, string>) => void;
}

interface DependencyFilesResult {
  manifestPath: string;
  packageJson: string;
  packageLockPath: string;
  packageLock: string | null;
}

const LOG_STORAGE_KEY = 'stitch_webcontainer_logs';
const MAX_LOG_CHUNKS = 400;
const READY_TIMEOUT_BY_ROLE: Record<string, number> = {
  frontend: 30000,
  backend: 10000,
  unknown: 15000,
};

let webcontainerInstance: WebContainer | null = null;
let terminalCssLoaded = false;
let webContainerModulePromise: Promise<typeof import('@webcontainer/api')> | null = null;
let terminalModulePromise: Promise<{ Terminal: typeof import('xterm').Terminal; FitAddon: typeof import('@xterm/addon-fit').FitAddon; }> | null = null;

function loadWebContainerModule() {
  if (!webContainerModulePromise) {
    webContainerModulePromise = import('@webcontainer/api');
  }
  return webContainerModulePromise;
}

async function loadTerminalModules() {
  if (!terminalModulePromise) {
    terminalModulePromise = Promise.all([
      import('xterm'),
      import('@xterm/addon-fit'),
      terminalCssLoaded ? Promise.resolve() : import('xterm/css/xterm.css'),
    ]).then(([xtermModule, fitModule]) => {
      terminalCssLoaded = true;
      return {
        Terminal: xtermModule.Terminal,
        FitAddon: fitModule.FitAddon,
      };
    });
  }

  return terminalModulePromise;
}

function buildFileSystemTree(files: Record<string, string>) {
  const tree: any = {};
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    let current = tree;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i === parts.length - 1) {
        // Check if it's a base64 encoded image
        if (content.startsWith('data:image/') && content.includes('base64,')) {
          const base64Data = content.split('base64,')[1];
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }
          current[part] = { file: { contents: bytes } };
        } else {
          current[part] = { file: { contents: content } };
        }
      } else {
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        current = current[part].directory;
      }
    }
  }
  return tree;
}

async function readFileIfExists(path: string) {
  try {
    return await webcontainerInstance?.fs.readFile(path, 'utf-8');
  } catch (_error) {
    return null;
  }
}

export function useWebContainer({ files, isGenerating, onFilesChange }: UseWebContainerOptions) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [isBooting, setIsBooting] = useState(false);
  const [bootPhase, setBootPhase] = useState<BootPhase>('idle');
  const [isSafeMode, setIsSafeMode] = useState(false);
  const [isAutoSync, setIsAutoSync] = useState(true);
  const [deviceSize, setDeviceSize] = useState<DeviceSize>('desktop');
  const [activeTab, setActiveTab] = useState<ActiveTab>('preview');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('single');
  const [devTargets, setDevTargets] = useState<DevTarget[]>([]);
  const [activePreviewTarget, setActivePreviewTarget] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    } catch (_error) {
      return [];
    }
  });

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import('xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const devProcessesRef = useRef<Record<string, any>>({});
  const installProcessRef = useRef<any>(null);
  const bootPromiseRef = useRef<Promise<void> | null>(null);
  const hasInstalledDependenciesRef = useRef(false);
  const currentDependencySignatureRef = useRef('');
  const serverReadyUnsubscribeRef = useRef<(() => void) | null>(null);
  const errorUnsubscribeRef = useRef<(() => void) | null>(null);
  const filesRef = useRef(files);
  const workspacePlanRef = useRef<DevWorkspacePlan | null>(null);
  const waitingForReadyTargetRef = useRef<string | null>(null);
  const targetUrlsRef = useRef<Record<string, string>>({});
  const skipNextAutoSyncRef = useRef(false);
  const lastMountedSnapshotRef = useRef('');

  const getMountSnapshot = useCallback((projectFiles: Record<string, string>) => {
    return JSON.stringify(getWebContainerFiles(projectFiles));
  }, []);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const appendTerminalChunk = useCallback((chunk: string) => {
    if (!chunk) return;

    if (xtermRef.current) {
      xtermRef.current.write(chunk);
    }

    setLogs((prev) => {
      const next = [...prev, chunk].slice(-MAX_LOG_CHUNKS);
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const appendSystemLog = useCallback((message: string) => {
    appendTerminalChunk(`\r\n\x1b[34m[System]\x1b[0m ${message}\r\n`);
  }, [appendTerminalChunk]);

  const cleanupListeners = useCallback(() => {
    serverReadyUnsubscribeRef.current?.();
    errorUnsubscribeRef.current?.();
    serverReadyUnsubscribeRef.current = null;
    errorUnsubscribeRef.current = null;
  }, []);

  const updateDevTarget = useCallback((manifestPath: string, updates: Partial<DevTarget>) => {
    setDevTargets((prev) => prev.map((target) => (
      target.manifestPath === manifestPath ? { ...target, ...updates } : target
    )));
  }, []);

  const chooseFallbackReadyTarget = useCallback(() => {
    const runTargets = workspacePlanRef.current?.runTargets || [];
    const unresolved = runTargets.filter((target) => !targetUrlsRef.current[target.path]);
    return unresolved.length === 1 ? unresolved[0].path : null;
  }, []);

  const markTargetReady = useCallback((manifestPath: string, url: string) => {
    targetUrlsRef.current[manifestPath] = url;
    updateDevTarget(manifestPath, { status: 'running', url, message: undefined });

    const plan = workspacePlanRef.current;
    const isPreviewTarget = plan?.previewTarget?.path === manifestPath;
    const shouldUseForPreview = isPreviewTarget || (!plan?.previewTarget && (plan?.mode === 'single' || !plan));

    if (shouldUseForPreview) {
      setPreviewUrl(url);
      setActivePreviewTarget(manifestPath);
      setBootPhase('ready');
    } else if (plan?.mode === 'single') {
      setBootPhase('ready');
    }
  }, [updateDevTarget]);

  const pipeProcessOutput = useCallback((process: any, label?: string) => {
    process.output
      .pipeTo(
        new WritableStream({
          write(data) {
            const chunk = String(data);
            if (!label) {
              appendTerminalChunk(chunk);
              return;
            }

            const prefixed = chunk
              .split('\n')
              .map((line, index, lines) => {
                const isLastEmptyLine = index === lines.length - 1 && line === '';
                if (isLastEmptyLine) return '';
                return `\x1b[35m[${label}]\x1b[0m ${line}`;
              })
              .join('\n');
            appendTerminalChunk(prefixed);
          },
        })
      )
      .catch(() => {
        // Ignore stream shutdown when process is killed intentionally.
      });
  }, [appendTerminalChunk]);

  const killAllDevProcesses = useCallback(() => {
    Object.values(devProcessesRef.current).forEach((process) => {
      try {
        process.kill();
      } catch (_error) {
        // Ignore already-stopped processes.
      }
    });
    devProcessesRef.current = {};
  }, []);

  const initializeWorkspaceTargets = useCallback((plan: DevWorkspacePlan) => {
    workspacePlanRef.current = plan;
    setWorkspaceMode(plan.mode);
    setDevTargets(createDevTargets(plan));
    setActivePreviewTarget(plan.previewTarget?.path || null);
    setPreviewUrl('');
    targetUrlsRef.current = {};
  }, []);

  const syncDependencyFilesFromContainer = useCallback(async (sourceFiles: Record<string, string> = filesRef.current) => {
    if (!webcontainerInstance || !onFilesChange) return;

    const manifests = getPackageManifests(sourceFiles);
    if (manifests.length === 0) return;

    let nextFiles = { ...filesRef.current };
    let changed = false;

    for (const manifest of manifests) {
      const packageJson = await readFileIfExists(manifest.path);
      if (!packageJson) continue;

      const packageLock = await readFileIfExists(manifest.lockPath);
      const updatedFiles = applyManifestFiles(nextFiles, manifest.path, packageJson, packageLock);
      if (
        updatedFiles[manifest.path] !== nextFiles[manifest.path] ||
        (updatedFiles[manifest.lockPath] || '') !== (nextFiles[manifest.lockPath] || '')
      ) {
        changed = true;
      }
      nextFiles = updatedFiles;
    }

    if (changed) {
      skipNextAutoSyncRef.current = true;
      onFilesChange(nextFiles);
    }
  }, [onFilesChange]);

  const runNpmCommandForManifest = useCallback(async (
    projectFiles: Record<string, string>,
    manifest: PackageManifestInfo,
    args: string[],
    logLabel: string
  ) => {
    if (!webcontainerInstance) return null;

    const locationLabel = getManifestLabel(manifest);
    appendSystemLog(`${logLabel} in ${locationLabel}...`);
    const process = await webcontainerInstance.spawn('npm', args, manifest.dir === '.' ? undefined : { cwd: manifest.dir });
    installProcessRef.current = process;
    pipeProcessOutput(process, `${locationLabel}:npm`);

    const exitCode = await process.exit;
    installProcessRef.current = null;

    if (exitCode !== 0) {
      appendSystemLog(`${logLabel} failed in ${locationLabel}.`);
      return null;
    }

    const packageJson = await readFileIfExists(manifest.path);
    if (!packageJson) return null;

    const packageLock = await readFileIfExists(manifest.lockPath);
    appendSystemLog(`${logLabel} completed in ${locationLabel}.`);

    return {
      manifestPath: manifest.path,
      packageJson,
      packageLockPath: manifest.lockPath,
      packageLock,
    } satisfies DependencyFilesResult;
  }, [appendSystemLog, pipeProcessOutput]);

  const installDependenciesIfNeeded = useCallback(async (projectFiles: Record<string, string>, forceInstall = false) => {
    if (!webcontainerInstance) return;

    const manifestSourceFiles = getPackageManifests(projectFiles).length > 0 ? projectFiles : getWebContainerFiles(projectFiles);
    const plan = getDevWorkspacePlan(manifestSourceFiles);
    const installTargets = plan.installTargets;

    if (installTargets.length === 0) {
      appendSystemLog('No package manifests detected. Skipping dependency installation.');
      hasInstalledDependenciesRef.current = true;
      currentDependencySignatureRef.current = '';
      return;
    }

    const signature = getDependencySignatureForFiles(manifestSourceFiles);
    const shouldInstall = forceInstall || !hasInstalledDependenciesRef.current || currentDependencySignatureRef.current !== signature;

    if (!shouldInstall) {
      appendSystemLog('Skipping dependency installation; existing environment is still valid.');
      return;
    }

    setBootPhase('installing');

    for (const manifest of installTargets) {
      updateDevTarget(manifest.path, { status: 'installing', message: 'Installing dependencies...' });
      const installCommand = manifestSourceFiles[manifest.lockPath] ? ['ci'] : ['install'];
      const result = await runNpmCommandForManifest(manifestSourceFiles, manifest, installCommand, `Running npm ${installCommand[0]}`);

      if (!result) {
        updateDevTarget(manifest.path, { status: 'failed', message: 'Dependency installation failed.' });
        throw new Error(`Dependency installation failed for ${manifest.path}`);
      }

      updateDevTarget(manifest.path, { status: 'idle', message: undefined });
    }

    hasInstalledDependenciesRef.current = true;
    currentDependencySignatureRef.current = signature;
    appendSystemLog(`Dependencies are ready for ${installTargets.length} package manifest${installTargets.length === 1 ? '' : 's'}.`);
    await syncDependencyFilesFromContainer(manifestSourceFiles);
  }, [appendSystemLog, runNpmCommandForManifest, syncDependencyFilesFromContainer, updateDevTarget]);

  const waitForTargetReady = useCallback(async (manifest: PackageManifestInfo) => {
    waitingForReadyTargetRef.current = manifest.path;
    const timeoutMs = READY_TIMEOUT_BY_ROLE[manifest.role] || READY_TIMEOUT_BY_ROLE.unknown;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (waitingForReadyTargetRef.current === manifest.path) {
          waitingForReadyTargetRef.current = null;
        }
        resolve();
      }, timeoutMs);

      const poll = () => {
        if (targetUrlsRef.current[manifest.path]) {
          clearTimeout(timer);
          if (waitingForReadyTargetRef.current === manifest.path) {
            waitingForReadyTargetRef.current = null;
          }
          resolve();
          return;
        }
        setTimeout(poll, 150);
      };

      poll();
    });
  }, []);

  const startDevTarget = useCallback(async (manifest: PackageManifestInfo) => {
    if (!webcontainerInstance) return;

    const label = getManifestLabel(manifest);
    updateDevTarget(manifest.path, { status: 'starting', message: 'Starting development server...' });
    appendSystemLog(`Starting ${label} development server...`);

    const process = await webcontainerInstance.spawn('npm', ['run', 'dev'], manifest.dir === '.' ? undefined : { cwd: manifest.dir });
    devProcessesRef.current[manifest.path] = process;
    pipeProcessOutput(process, label);

    process.exit
      .then((exitCode: number) => {
        const current = devProcessesRef.current[manifest.path];
        if (current !== process) return;
        delete devProcessesRef.current[manifest.path];

        if (exitCode !== 0) {
          updateDevTarget(manifest.path, { status: 'failed', message: `Exited with code ${exitCode}` });
          appendSystemLog(`${label} exited with code ${exitCode}.`);
          if (workspacePlanRef.current?.previewTarget?.path === manifest.path) {
            setBootPhase('error');
          }
        }
      })
      .catch(() => {
        // Ignore process cancellation during resets.
      });

    await waitForTargetReady(manifest);
  }, [appendSystemLog, pipeProcessOutput, updateDevTarget, waitForTargetReady]);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    void loadTerminalModules().then(({ Terminal, FitAddon }) => {
      if (disposed || !terminalRef.current || xtermRef.current) return;

      const term = new Terminal({
        theme: { background: '#09090b', foreground: '#a1a1aa' },
        fontFamily: 'monospace',
        fontSize: 12,
        convertEol: true,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);

      try {
        fitAddon.fit();
      } catch (_error) {
        // Ignore transient fit failures during initial mount.
      }

      logs.forEach((chunk) => term.write(chunk));

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      resizeObserver = new ResizeObserver(() => {
        if (!terminalRef.current || terminalRef.current.offsetWidth === 0) return;

        requestAnimationFrame(() => {
          try {
            if (xtermRef.current && xtermRef.current.element && fitAddonRef.current) {
              fitAddonRef.current.fit();
            }
          } catch (_error) {
            // Ignore fit errors when terminal is hidden.
          }
        });
      });
      resizeObserver.observe(terminalRef.current);
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (xtermRef.current) {
        try {
          xtermRef.current.dispose();
        } catch (_error) {
          // Ignore disposal errors during teardown.
        }
        xtermRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, [logs]);

  useEffect(() => {
    if (terminalRef.current && terminalRef.current.offsetWidth > 0) {
      const timer = setTimeout(() => {
        try {
          if (xtermRef.current && xtermRef.current.element && fitAddonRef.current) {
            fitAddonRef.current.fit();
          }
        } catch (_error) {
          // Ignore fit errors while panels are transitioning.
        }
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  const bootContainer = useCallback(async (initialFiles: Record<string, string>, options?: { forceInstall?: boolean; reason?: string }) => {
    if (!xtermRef.current) return;
    if (bootPromiseRef.current) return bootPromiseRef.current;

    bootPromiseRef.current = (async () => {
      setIsBooting(true);
      setBootPhase('booting');
      setPreviewUrl('');

      try {
        const shouldBootFresh = !webcontainerInstance;
        if (options?.reason) {
          appendSystemLog(options.reason);
        }

        if (shouldBootFresh) {
          appendSystemLog('Booting WebContainer micro-OS...');
          const { WebContainer } = await loadWebContainerModule();
          webcontainerInstance = await WebContainer.boot({ forwardPreviewErrors: 'exceptions-only' });
          hasInstalledDependenciesRef.current = false;
          currentDependencySignatureRef.current = '';
          appendSystemLog('WebContainer booted successfully.');
        } else {
          appendSystemLog('Reusing current WebContainer instance.');
        }

        cleanupListeners();
        serverReadyUnsubscribeRef.current = webcontainerInstance.on('server-ready', (_port, url) => {
          const targetPath = waitingForReadyTargetRef.current || chooseFallbackReadyTarget();
          appendSystemLog(`Server ready at ${url}`);
          if (targetPath) {
            markTargetReady(targetPath, url);
          }
        });
        errorUnsubscribeRef.current = webcontainerInstance.on('error', (error) => {
          appendSystemLog(`WebContainer error: ${error.message}`);
          setBootPhase('error');
        });

        const manifestSourceFiles = getPackageManifests(initialFiles).length > 0 ? initialFiles : getWebContainerFiles(initialFiles);
        const workspacePlan = getDevWorkspacePlan(manifestSourceFiles);
        if (workspacePlan.runTargets.length === 0) {
          throw new Error('No runnable package manifest with a dev script was found.');
        }

        initializeWorkspaceTargets(workspacePlan);
        killAllDevProcesses();
        waitingForReadyTargetRef.current = null;

        appendSystemLog('Mounting project files...');
        const mountSnapshot = getMountSnapshot(initialFiles);
        await webcontainerInstance.mount(buildFileSystemTree(getWebContainerFiles(initialFiles)));
        lastMountedSnapshotRef.current = mountSnapshot;
        await installDependenciesIfNeeded(manifestSourceFiles, shouldBootFresh || Boolean(options?.forceInstall));

        setBootPhase('starting');
        for (const target of workspacePlan.runTargets) {
          await startDevTarget(target);
        }

      } catch (err: any) {
        setPreviewUrl('');
        setBootPhase('error');
        appendSystemLog(`Error: ${err.message}`);
      } finally {
        setIsBooting(false);
        bootPromiseRef.current = null;
      }
    })();

    return bootPromiseRef.current;
  }, [appendSystemLog, chooseFallbackReadyTarget, cleanupListeners, getMountSnapshot, initializeWorkspaceTargets, installDependenciesIfNeeded, killAllDevProcesses, markTargetReady, startDevTarget]);

  useEffect(() => {
    if (!webcontainerInstance || !isAutoSync || isSafeMode || isGenerating || bootPhase !== 'ready') {
      return;
    }

    const timer = setTimeout(async () => {
      if (skipNextAutoSyncRef.current) {
        skipNextAutoSyncRef.current = false;
        return;
      }

      const nextSnapshot = getMountSnapshot(files);
      if (nextSnapshot === lastMountedSnapshotRef.current) {
        return;
      }

      try {
        await webcontainerInstance!.mount(buildFileSystemTree(getWebContainerFiles(files)));
        lastMountedSnapshotRef.current = nextSnapshot;
      } catch (error: any) {
        appendSystemLog(`Failed to sync files: ${error.message || 'unknown error'}`);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [appendSystemLog, bootPhase, files, getMountSnapshot, isAutoSync, isGenerating, isSafeMode]);

  const hasBooted = useRef(false);
  useEffect(() => {
    if (Object.keys(files).length > 0 && !hasBooted.current && !isGenerating && xtermRef.current) {
      hasBooted.current = true;
      bootContainer(files, { reason: 'Restoring project preview...' });
    }
  }, [bootContainer, files, isGenerating]);

  const syncPreview = useCallback(async () => {
    if (!webcontainerInstance) return;

    appendSystemLog('Manual sync requested.');
    const nextSnapshot = getMountSnapshot(filesRef.current);
    await webcontainerInstance.mount(buildFileSystemTree(getWebContainerFiles(filesRef.current)));
    lastMountedSnapshotRef.current = nextSnapshot;
  }, [appendSystemLog, getMountSnapshot]);

  const resetViewer = useCallback(() => {
    hasBooted.current = false;
    setPreviewUrl('');
    setBootPhase('idle');
    waitingForReadyTargetRef.current = null;
    killAllDevProcesses();
    bootContainer(filesRef.current, { reason: 'Resetting development environment...' });
  }, [bootContainer, killAllDevProcesses]);

  const installPackage = useCallback(async (pkg: string, manifestPath: string) => {
    if (!webcontainerInstance) return null;

    const manifest = getPackageManifestByPath(filesRef.current, manifestPath);
    if (!manifest) return null;

    updateDevTarget(manifestPath, { status: 'installing', message: `Installing ${pkg}...` });
    const dependencyFiles = await runNpmCommandForManifest(filesRef.current, manifest, ['install', pkg], `Installing package ${pkg}`);
    if (!dependencyFiles) {
      updateDevTarget(manifestPath, { status: 'failed', message: `Failed to install ${pkg}.` });
      return null;
    }

    const nextFiles = applyManifestFiles(filesRef.current, dependencyFiles.manifestPath, dependencyFiles.packageJson, dependencyFiles.packageLock);
    currentDependencySignatureRef.current = getDependencySignatureForFiles(nextFiles);
    hasInstalledDependenciesRef.current = true;
    await syncDependencyFilesFromContainer(nextFiles);
    updateDevTarget(manifestPath, { status: targetUrlsRef.current[manifestPath] ? 'running' : 'idle', message: undefined });
    return dependencyFiles;
  }, [runNpmCommandForManifest, syncDependencyFilesFromContainer, updateDevTarget]);

  const uninstallPackage = useCallback(async (pkg: string, manifestPath: string) => {
    if (!webcontainerInstance) return null;

    const manifest = getPackageManifestByPath(filesRef.current, manifestPath);
    if (!manifest) return null;

    updateDevTarget(manifestPath, { status: 'installing', message: `Removing ${pkg}...` });
    const dependencyFiles = await runNpmCommandForManifest(filesRef.current, manifest, ['uninstall', pkg], `Removing package ${pkg}`);
    if (!dependencyFiles) {
      updateDevTarget(manifestPath, { status: 'failed', message: `Failed to remove ${pkg}.` });
      return null;
    }

    const nextFiles = applyManifestFiles(filesRef.current, dependencyFiles.manifestPath, dependencyFiles.packageJson, dependencyFiles.packageLock);
    currentDependencySignatureRef.current = getDependencySignatureForFiles(nextFiles);
    hasInstalledDependenciesRef.current = true;
    await syncDependencyFilesFromContainer(nextFiles);
    updateDevTarget(manifestPath, { status: targetUrlsRef.current[manifestPath] ? 'running' : 'idle', message: undefined });
    return dependencyFiles;
  }, [runNpmCommandForManifest, syncDependencyFilesFromContainer, updateDevTarget]);

  const getIframeWidth = useCallback(() => {
    switch (deviceSize) {
      case 'mobile':
        return 'w-[375px]';
      case 'tablet':
        return 'w-[768px]';
      case 'desktop':
        return 'w-full';
    }
  }, [deviceSize]);

  useEffect(() => {
    return () => {
      cleanupListeners();
      killAllDevProcesses();
      installProcessRef.current?.kill?.();
    };
  }, [cleanupListeners, killAllDevProcesses]);

  return {
    iframeUrl: previewUrl,
    previewUrl,
    activePreviewTarget,
    workspaceMode,
    devTargets,
    isBooting,
    bootPhase,
    logs,
    isSafeMode,
    setIsSafeMode,
    isAutoSync,
    setIsAutoSync,
    deviceSize,
    setDeviceSize,
    activeTab,
    setActiveTab,
    syncPreview,
    resetViewer,
    installPackage,
    uninstallPackage,
    getIframeWidth,
    terminalRef,
  };
}
