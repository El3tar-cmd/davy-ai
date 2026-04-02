import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { Monitor } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';

import { useOllamaModels } from './hooks/useOllamaModels';
import { useProjects } from './hooks/useProjects';
import { useAttachments } from './hooks/useAttachments';
import { useChat } from './hooks/useChat';
import { useWebContainer } from './hooks/useWebContainer';

import { exportToZip, exportToStackBlitz } from './utils/export';
import { buildDatabaseFiles, getDatabaseStatus } from './utils/database-config';
import {
  applyManifestFiles,
  getDependenciesForManifest,
  getPackageManifests,
  getPrimaryPackageManifest,
} from './utils/package-manifests';
import type { DatabaseConfig } from './utils/database-config';

import { ChatSidebar } from './components/chat/ChatSidebar';
import { MainToolbar } from './components/toolbar/MainToolbar';
import { PreviewPanel } from './components/preview/PreviewPanel';
import type { RuntimeValidationResult } from './types';

const CodeView = lazy(() => import('./components/editor/CodeView').then((module) => ({ default: module.CodeView })));
const SettingsModal = lazy(() => import('./components/modals/SettingsModal').then((module) => ({ default: module.SettingsModal })));
const ProjectsSidebar = lazy(() => import('./components/modals/ProjectsSidebar').then((module) => ({ default: module.ProjectsSidebar })));
const PackageManagerModal = lazy(() => import('./components/modals/PackageManagerModal').then((module) => ({ default: module.PackageManagerModal })));
const GitHubModal = lazy(() => import('./components/modals/GitHubModal').then((module) => ({ default: module.GitHubModal })));
const DatabaseModal = lazy(() => import('./components/modals/DatabaseModal').then((module) => ({ default: module.DatabaseModal })));

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProjectsSidebarOpen, setIsProjectsSidebarOpen] = useState(false);
  const [isPackageManagerOpen, setIsPackageManagerOpen] = useState(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [isDatabaseModalOpen, setIsDatabaseModalOpen] = useState(false);
  const [isTerminalVisible, setIsTerminalVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedPackageManifestPath, setSelectedPackageManifestPath] = useState('package.json');
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);
  const [runtimeDomSnapshot, setRuntimeDomSnapshot] = useState('');
  const runtimeErrorsRef = useRef<string[]>([]);
  const runtimeDomSnapshotRef = useRef('');
  const previewUrlRef = useRef('');
  const bootPhaseRef = useRef<'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'error'>('idle');
  const generationRunIdRef = useRef(0);
  const validatedGenerationRunIdRef = useRef<number | null>(null);

  const { endpoint, setEndpoint, models, selectedModel, setSelectedModel } =
    useOllamaModels();

  const {
    projects,
    currentProject,
    currentProjectId,
    messages,
    files,
    updateCurrentProject,
    pushToHistory,
    handleUndo,
    handleRedo,
    createProject,
    switchProject,
    deleteProject,
    clearChat,
  } = useProjects();

  const {
    attachments,
    isProcessing,
    fileInputRef,
    handleFileChange,
    removeAttachment,
    clearAttachments,
  } = useAttachments();

  const {
    input,
    setInput,
    isGenerating,
    isSearching,
    isWebSearchEnabled,
    setIsWebSearchEnabled,
    isMultiAgentEnabled,
    setIsMultiAgentEnabled,
    error,
    clearError,
    sendMessage,
    stopGeneration,
    generationPhase,
    activeAgent,
    gateResults,
    generationSummary,
    generationRunId,
    applyRuntimeValidation,
  } = useChat({
    messages,
    files,
    endpoint,
    selectedModel,
    attachments,
    clearAttachments,
    updateCurrentProject,
    pushToHistory,
    currentProjectName: currentProject.name,
  });

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const databaseStatus = getDatabaseStatus(files);
  const packageManifests = getPackageManifests(files);
  const primaryPackageManifest = getPrimaryPackageManifest(files);
  const activePackageManifestPath = packageManifests.some((manifest) => manifest.path === selectedPackageManifestPath)
    ? selectedPackageManifestPath
    : primaryPackageManifest?.path || packageManifests[0]?.path || 'package.json';

  useEffect(() => {
    if (activePackageManifestPath !== selectedPackageManifestPath) {
      setSelectedPackageManifestPath(activePackageManifestPath);
    }
  }, [activePackageManifestPath, selectedPackageManifestPath]);

  const handleContainerFilesChange = useCallback(
    (nextFiles: Record<string, string>) => {
      const currentKeys = Object.keys(files);
      const nextKeys = Object.keys(nextFiles);
      const unchanged =
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => files[key] === nextFiles[key]);

      if (!unchanged) {
        updateCurrentProject({ files: nextFiles });
      }
    },
    [files, updateCurrentProject]
  );

  const {
    previewUrl,
    activePreviewTarget,
    workspaceMode,
    devTargets,
    isBooting,
    bootPhase,
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
    getIframeWidth,
    terminalRef,
    installPackage,
    uninstallPackage,
  } = useWebContainer({
    files,
    isGenerating,
    onFilesChange: handleContainerFilesChange,
  });

  useEffect(() => {
    runtimeErrorsRef.current = runtimeErrors;
  }, [runtimeErrors]);

  useEffect(() => {
    runtimeDomSnapshotRef.current = runtimeDomSnapshot;
  }, [runtimeDomSnapshot]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    bootPhaseRef.current = bootPhase;
  }, [bootPhase]);

  useEffect(() => {
    generationRunIdRef.current = generationRunId;
    setRuntimeErrors([]);
    setRuntimeDomSnapshot('');
    validatedGenerationRunIdRef.current = null;
  }, [generationRunId]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const expectedOrigin = previewUrl ? new URL(previewUrl).origin : null;
      const frameWindow = previewFrameRef.current?.contentWindow;

      if (!e.data || !expectedOrigin || !frameWindow) return;
      if (e.origin !== expectedOrigin || e.source !== frameWindow) return;
      if (typeof e.data !== 'object' || typeof e.data.type !== 'string') return;

      if (e.data.type === 'CLICK_TO_EDIT') {
        const { tagName, className, id, text } = e.data as {
          tagName?: string;
          className?: string;
          id?: string;
          text?: string;
        };
        if (typeof tagName !== 'string') return;

        let selector = tagName;
        if (id) selector += `#${id}`;
        if (className) {
          selector += `.${className.split(' ').filter(Boolean).join('.')}`;
        }

        const textFocus = text ? ` containing "${text.trim()}"` : '';
        const uiMessage = `[Selected element: <${selector}>${textFocus}]`;
        setInput((prev) => (prev ? `${prev.trim()}
${uiMessage}
` : `${uiMessage}
`));
      } else if (e.data.type === 'RUNTIME_ERROR') {
        const errorMsg = (e.data as { payload?: string }).payload;
        if (typeof errorMsg !== 'string') return;
        setRuntimeErrors((prev) => (prev.includes(errorMsg) ? prev : [...prev, errorMsg]));
        setInput((prev) => {
          if (prev.includes(errorMsg)) return prev;
          return prev ? `${prev.trim()}

${errorMsg}
` : `${errorMsg}
`;
        });
      } else if (e.data.type === 'DOM_SNAPSHOT') {
        const payload = (e.data as { payload?: string }).payload;
        if (typeof payload !== 'string') return;
        setRuntimeDomSnapshot(payload);
        const snapshotMsg = `

--- CURRENT APP DOM SNAPSHOT ---
${payload}
--- END DOM ---
`;
        setInput((prev) => (prev ? `${prev.trim()}${snapshotMsg}` : snapshotMsg));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [previewUrl, setInput]);

  useEffect(() => {
    if (!generationSummary || isGenerating || generationRunId === 0) {
      return;
    }

    if (validatedGenerationRunIdRef.current === generationRunId) {
      return;
    }

    validatedGenerationRunIdRef.current = generationRunId;
    let cancelled = false;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const requestSnapshot = () => {
      const iframeWindow = previewFrameRef.current?.contentWindow;
      const previewOrigin = previewFrameRef.current?.src ? new URL(previewFrameRef.current.src).origin : null;

      if (iframeWindow && previewOrigin) {
        iframeWindow.postMessage({ type: 'REQUEST_DOM_SNAPSHOT' }, previewOrigin);
      }
    };

    const validate = async () => {
      const runId = generationRunId;
      const startedAt = Date.now();
      const initialErrorCount = runtimeErrorsRef.current.length;
      const requiresPreviewUrl = generationSummary.appKind !== 'backend';

      while (!cancelled && generationRunIdRef.current === runId) {
        if (bootPhaseRef.current === 'error') {
          requestSnapshot();
          await sleep(300);
          const result: RuntimeValidationResult = {
            status: 'fail',
            errors: runtimeErrorsRef.current.slice(initialErrorCount),
            bootPhase: bootPhaseRef.current,
            previewUrlPresent: Boolean(previewUrlRef.current),
            domSnapshot: runtimeDomSnapshotRef.current || undefined,
          };
          await applyRuntimeValidation(result);
          return;
        }

        if (bootPhaseRef.current === 'ready') {
          break;
        }

        if (Date.now() - startedAt > 15000) {
          const result: RuntimeValidationResult = {
            status: 'timeout',
            errors: runtimeErrorsRef.current.slice(initialErrorCount),
            bootPhase: bootPhaseRef.current,
            previewUrlPresent: Boolean(previewUrlRef.current),
            domSnapshot: runtimeDomSnapshotRef.current || undefined,
          };
          await applyRuntimeValidation(result);
          return;
        }

        await sleep(250);
      }

      if (cancelled || generationRunIdRef.current !== runId) {
        return;
      }

      await sleep(1800);

      if (cancelled || generationRunIdRef.current !== runId) {
        return;
      }

      const errors = runtimeErrorsRef.current.slice(initialErrorCount);
      const previewUrlPresent = Boolean(previewUrlRef.current);

      if (errors.length > 0 || (requiresPreviewUrl && !previewUrlPresent)) {
        requestSnapshot();
        await sleep(300);
        const result: RuntimeValidationResult = {
          status: 'fail',
          errors: runtimeErrorsRef.current.slice(initialErrorCount),
          bootPhase: bootPhaseRef.current,
          previewUrlPresent: Boolean(previewUrlRef.current),
          domSnapshot: runtimeDomSnapshotRef.current || undefined,
        };
        await applyRuntimeValidation(result);
        return;
      }

      const result: RuntimeValidationResult = {
        status: 'pass',
        errors: [],
        bootPhase: bootPhaseRef.current,
        previewUrlPresent,
        domSnapshot: undefined,
      };
      await applyRuntimeValidation(result);
    };

    void validate();

    return () => {
      cancelled = true;
    };
  }, [applyRuntimeValidation, generationRunId, generationSummary, isGenerating]);

  const handleSendMessage = () => {
    setIsMobileMenuOpen(false);
    sendMessage();
  };

  const handleResetViewer = () => {
    resetViewer();
    clearError();
  };

  const handleCreateProject = () => {
    createProject();
    setIsProjectsSidebarOpen(false);
  };

  const handleSwitchProject = (id: string) => {
    if (isGenerating) stopGeneration();
    switchProject(id);
    setIsProjectsSidebarOpen(false);
  };

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === currentProjectId && isGenerating) {
      stopGeneration();
    }
    deleteProject(id);
  };

  const handleExportZip = () => {
    void exportToZip(files, currentProject.name);
  };

  const handleExportStackBlitz = () => {
    void exportToStackBlitz(files, currentProject.name);
  };

  const handleSaveToHistory = () => {
    pushToHistory(messages, files);
  };

  const handleOpenDatabase = () => {
    setIsDatabaseModalOpen(true);
  };

  const handleSaveDatabaseConfig = (config: DatabaseConfig) => {
    const nextFiles = buildDatabaseFiles(config, files);
    updateCurrentProject({ files: nextFiles });
  };

  const handleAddPackage = async (pkg: string, manifestPath: string) => {
    const dependencyFiles = await installPackage(pkg, manifestPath);
    if (!dependencyFiles) return;

    updateCurrentProject({
      files: applyManifestFiles(files, dependencyFiles.manifestPath, dependencyFiles.packageJson, dependencyFiles.packageLock),
    });
  };

  const handleRemovePackage = async (pkg: string, manifestPath: string) => {
    const dependencyFiles = await uninstallPackage(pkg, manifestPath);
    if (!dependencyFiles) return;

    updateCurrentProject({
      files: applyManifestFiles(files, dependencyFiles.manifestPath, dependencyFiles.packageJson, dependencyFiles.packageLock),
    });
  };

  const getDependencies = () => getDependenciesForManifest(files, activePackageManifestPath);
  const activePreviewTargetLabel = devTargets.find((target) => target.manifestPath === activePreviewTarget)?.label || null;

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 font-sans overflow-hidden relative">
      {isMobile && (
        <ChatSidebar
          currentProject={currentProject}
          onOpenProjects={() => setIsProjectsSidebarOpen(true)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClearChat={clearChat}
          onOpenSettings={() => setShowSettings(true)}
          messages={messages}
          isGenerating={isGenerating}
          isSearching={isSearching}
          generationPhase={generationPhase}
          activeAgent={activeAgent}
          gateResults={gateResults}
          generationSummary={generationSummary}
          onPromptSelect={setInput}
          input={input}
          onInputChange={setInput}
          onSend={handleSendMessage}
          onStopGeneration={stopGeneration}
          selectedModel={selectedModel}
          isWebSearchEnabled={isWebSearchEnabled}
          onToggleWebSearch={() => setIsWebSearchEnabled((prev) => !prev)}
          isMultiAgentEnabled={isMultiAgentEnabled}
          onToggleMultiAgent={() => setIsMultiAgentEnabled((prev) => !prev)}
          error={error}
          attachments={attachments}
          isProcessing={isProcessing}
          onRemoveAttachment={removeAttachment}
          onFileChange={handleFileChange}
          fileInputRef={fileInputRef}
          previewFrameRef={previewFrameRef}
          databaseProvider={databaseStatus.provider}
          isDatabaseConfigured={databaseStatus.isConfigured}
          isMobileMenuOpen={isMobileMenuOpen}
          onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        />
      )}

      <PanelGroup orientation="horizontal">
        {!isMobile && (
          <>
            <Panel defaultSize={25} minSize={20} maxSize={40}>
              <ChatSidebar
                currentProject={currentProject}
                onOpenProjects={() => setIsProjectsSidebarOpen(true)}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onClearChat={clearChat}
                onOpenSettings={() => setShowSettings(true)}
                messages={messages}
                isGenerating={isGenerating}
                isSearching={isSearching}
                generationPhase={generationPhase}
                activeAgent={activeAgent}
                gateResults={gateResults}
                generationSummary={generationSummary}
                onPromptSelect={setInput}
                input={input}
                onInputChange={setInput}
                onSend={handleSendMessage}
                onStopGeneration={stopGeneration}
                selectedModel={selectedModel}
                isWebSearchEnabled={isWebSearchEnabled}
                onToggleWebSearch={() => setIsWebSearchEnabled((prev) => !prev)}
                isMultiAgentEnabled={isMultiAgentEnabled}
                onToggleMultiAgent={() => setIsMultiAgentEnabled((prev) => !prev)}
                error={error}
                attachments={attachments}
                isProcessing={isProcessing}
                onRemoveAttachment={removeAttachment}
                onFileChange={handleFileChange}
                fileInputRef={fileInputRef}
                previewFrameRef={previewFrameRef}
                databaseProvider={databaseStatus.provider}
                isDatabaseConfigured={databaseStatus.isConfigured}
                isMobileMenuOpen={isMobileMenuOpen}
                onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
              />
            </Panel>
            <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-indigo-500 transition-colors cursor-col-resize" />
          </>
        )}

        <Panel defaultSize={isMobile ? 100 : 75} minSize={0}>
          <div className="h-full flex flex-col bg-zinc-950 min-w-0 w-full">
            <MainToolbar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              deviceSize={deviceSize}
              onDeviceSizeChange={setDeviceSize}
              isAutoSync={isAutoSync}
              onToggleAutoSync={() => setIsAutoSync(!isAutoSync)}
              onManualSync={syncPreview}
              isGenerating={isGenerating}
              onResetViewer={handleResetViewer}
              onExportZip={handleExportZip}
              hasFiles={Object.keys(files).length > 0}
              onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
              onOpenPackageManager={() => setIsPackageManagerOpen(true)}
              onOpenGitHub={() => setIsGitHubModalOpen(true)}
              onOpenDatabase={handleOpenDatabase}
              onSave={handleSaveToHistory}
              isTerminalVisible={isTerminalVisible}
              onToggleTerminal={() => setIsTerminalVisible((prev) => !prev)}
            />

            <div className="flex-1 overflow-hidden relative bg-[#0a0a0a] flex items-center justify-center p-4">
              {Object.keys(files).length === 0 && !isGenerating ? (
                <div className="text-center text-zinc-600 flex flex-col items-center justify-center h-full w-full absolute inset-0 z-20 bg-zinc-950">
                  <Monitor className="w-12 h-12 mb-4 opacity-20" />
                  <p>Your generated React app will appear here.</p>
                </div>
              ) : null}

              <div
                className={`absolute inset-4 sm:inset-6 transition-opacity duration-200 ${
                  activeTab === 'preview' || activeTab === 'console'
                    ? 'opacity-100 z-10'
                    : 'opacity-0 z-0 pointer-events-none'
                }`}
              >
                <PreviewPanel
                  activeTab={activeTab}
                  isSafeMode={isSafeMode}
                  isGenerating={isGenerating}
                  iframeWidth={getIframeWidth()}
                  previewUrl={previewUrl}
                  isBooting={isBooting}
                  terminalRef={terminalRef}
                  iframeRef={previewFrameRef}
                  workspaceMode={workspaceMode}
                  devTargets={devTargets}
                  activePreviewTargetLabel={activePreviewTargetLabel}
                />
              </div>

              <div
                className={`absolute inset-4 sm:inset-6 transition-opacity duration-200 ${
                  activeTab === 'code' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                }`}
              >
                <Suspense fallback={<div className="w-full h-full rounded-lg border border-zinc-800 bg-[#1e1e1e] flex items-center justify-center text-sm text-zinc-500">Loading editor...</div>}><CodeView
                  files={files}
                  currentProject={currentProject}
                  messages={messages}
                  onUpdateFiles={(newFiles) => updateCurrentProject({ files: newFiles })}
                  onSaveToHistory={handleSaveToHistory}
                  isTerminalVisible={isTerminalVisible}
                  terminalRef={terminalRef}
                  isActive={activeTab === 'code'}
                /></Suspense>
              </div>
            </div>
          </div>
        </Panel>
      </PanelGroup>

      {isProjectsSidebarOpen && <Suspense fallback={null}><ProjectsSidebar
        isOpen={isProjectsSidebarOpen}
        onClose={() => setIsProjectsSidebarOpen(false)}
        projects={projects}
        currentProjectId={currentProjectId}
        onCreateProject={handleCreateProject}
        onSwitchProject={handleSwitchProject}
        onDeleteProject={handleDeleteProject}
      /></Suspense>}

      {showSettings && <Suspense fallback={null}><SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        endpoint={endpoint}
        onEndpointChange={setEndpoint}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      /></Suspense>}

      {isPackageManagerOpen && <Suspense fallback={null}><PackageManagerModal
        isOpen={isPackageManagerOpen}
        onClose={() => setIsPackageManagerOpen(false)}
        dependencies={getDependencies()}
        manifests={packageManifests}
        selectedManifestPath={activePackageManifestPath}
        onSelectedManifestPathChange={setSelectedPackageManifestPath}
        onAddPackage={handleAddPackage}
        onRemovePackage={handleRemovePackage}
      /></Suspense>}

      {isGitHubModalOpen && <Suspense fallback={null}><GitHubModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        files={files}
        projectName={currentProject.name}
      /></Suspense>}

      {isDatabaseModalOpen && <Suspense fallback={null}><DatabaseModal
        isOpen={isDatabaseModalOpen}
        onClose={() => setIsDatabaseModalOpen(false)}
        initialConfig={databaseStatus.config}
        onSave={handleSaveDatabaseConfig}
      /></Suspense>}
    </div>
  );
}
