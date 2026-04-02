import React, { useEffect, useState } from 'react';
import { FileCode2, FolderTree, GitCompare, Save, Terminal, X } from 'lucide-react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { FileExplorer } from './FileExplorer';
import type { Project, OllamaMessage } from '../../types';

interface CodeViewProps {
  files: Record<string, string>;
  currentProject: Project;
  messages: OllamaMessage[];
  onUpdateFiles: (files: Record<string, string>) => void;
  onSaveToHistory: () => void;
  isTerminalVisible?: boolean;
  terminalRef?: React.RefObject<HTMLDivElement | null>;
  isActive?: boolean;
}

function getLanguage(filename: string): string {
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript';
  if (filename.endsWith('.css')) return 'css';
  if (filename.endsWith('.html')) return 'html';
  if (filename.endsWith('.json')) return 'json';
  return 'javascript';
}

function getDefaultFile(files: Record<string, string>) {
  if (files['src/App.tsx']) return 'src/App.tsx';
  const sortedFiles = Object.keys(files).sort();
  return sortedFiles[0] || '';
}

export function CodeView({
  files,
  currentProject,
  messages,
  onUpdateFiles,
  onSaveToHistory,
  isTerminalVisible = true,
  terminalRef,
  isActive = false,
}: CodeViewProps) {
  const [selectedFile, setSelectedFile] = useState<string>(() => getDefaultFile(files));
  const [isDiffView, setIsDiffView] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileExplorerOpen, setIsMobileExplorerOpen] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!selectedFile || !files[selectedFile]) {
      setSelectedFile(getDefaultFile(files));
    }
  }, [files, selectedFile]);

  const previousFiles =
    currentProject.historyIndex > 0
      ? currentProject.history[currentProject.historyIndex - 1].files
      : {};

  const recentGeneratedFiles = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const generated = messages[i].filesGenerated;
      if (messages[i].role === 'assistant' && generated && generated.length > 0) {
        return generated;
      }
    }
    return [] as string[];
  })();

  const handleCreateFile = (path: string) => {
    if (!files[path]) {
      onUpdateFiles({ ...files, [path]: '// New file\n' });
      setSelectedFile(path);
      setIsMobileExplorerOpen(false);
    }
  };

  const handleDeleteFile = (path: string) => {
    const newFiles = { ...files };
    delete newFiles[path];
    onUpdateFiles(newFiles);
    if (selectedFile === path) {
      setSelectedFile(getDefaultFile(newFiles));
    }
  };

  const handleRenameFile = (oldPath: string, newPath: string) => {
    if (files[oldPath] && !files[newPath]) {
      const newFiles = { ...files };
      newFiles[newPath] = newFiles[oldPath];
      delete newFiles[oldPath];
      onUpdateFiles(newFiles);
      if (selectedFile === oldPath) {
        setSelectedFile(newPath);
      }
    }
  };

  const handleSelectFile = (path: string) => {
    setSelectedFile(path);
    setIsMobileExplorerOpen(false);
  };

  const renderEditor = () => {
    if (!selectedFile) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          No file selected yet.
        </div>
      );
    }

    if (isDiffView) {
      return (
        <DiffEditor
          height="100%"
          language={getLanguage(selectedFile)}
          theme="vs-dark"
          original={previousFiles[selectedFile] || ''}
          modified={files[selectedFile] || ''}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            readOnly: true,
            renderSideBySide: !isMobile,
          }}
        />
      );
    }

    return (
      <Editor
        height="100%"
        language={getLanguage(selectedFile)}
        theme="vs-dark"
        value={files[selectedFile] || ''}
        onChange={(value) => {
          if (value !== undefined && selectedFile) {
            onUpdateFiles({ ...files, [selectedFile]: value });
          }
        }}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: 'on',
          tabSize: 2,
        }}
      />
    );
  };

  const editorPanel = (
    <div className="flex-1 h-full overflow-hidden flex flex-col bg-[#1e1e1e]">
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <div className="text-sm text-[#cccccc] flex items-center gap-2 min-w-0">
          <FileCode2 className="w-4 h-4 shrink-0" />
          <span className="truncate">{selectedFile || 'No file selected'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsDiffView((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              isDiffView
                ? 'bg-indigo-500/20 text-indigo-400'
                : 'bg-[#3c3c3c] text-[#cccccc] hover:bg-[#4d4d4d]'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            Diff
          </button>
          <button
            onClick={onSaveToHistory}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[#3c3c3c] text-[#cccccc] hover:bg-[#4d4d4d] transition-colors"
            title="Save manual edits to history"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>
      <div className="flex-1 relative">{renderEditor()}</div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="w-full h-full flex flex-col bg-[#1e1e1e] rounded-lg border border-zinc-800 overflow-hidden relative">
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#252526] border-b border-[#3c3c3c]">
          <button
            onClick={() => setIsMobileExplorerOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200"
          >
            <FolderTree className="w-4 h-4" />
            Files
          </button>
          <div className="truncate text-xs text-zinc-400 max-w-[55%]">{selectedFile || 'No file selected'}</div>
        </div>

        {isMobileExplorerOpen && (
          <div className="absolute inset-0 z-20 flex bg-black/60 backdrop-blur-sm">
            <div className="w-[85%] max-w-sm h-full bg-zinc-900 border-r border-zinc-800">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div className="text-sm font-semibold text-zinc-200">Project Files</div>
                <button
                  onClick={() => setIsMobileExplorerOpen(false)}
                  className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="h-[calc(100%-53px)]">
                <FileExplorer
                  files={files}
                  selectedFile={selectedFile}
                  recentGeneratedFiles={recentGeneratedFiles}
                  onSelectFile={handleSelectFile}
                  onCreateFile={handleCreateFile}
                  onDeleteFile={handleDeleteFile}
                  onRenameFile={handleRenameFile}
                />
              </div>
            </div>
            <button className="flex-1" onClick={() => setIsMobileExplorerOpen(false)} aria-label="Close file tree" />
          </div>
        )}

        <div className="flex-1 min-h-0">{editorPanel}</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex bg-[#1e1e1e] rounded-lg border border-zinc-800 overflow-hidden">
      <PanelGroup orientation="horizontal">
        <Panel defaultSize={20} minSize={15} maxSize={40}>
          <FileExplorer
            files={files}
            selectedFile={selectedFile}
            recentGeneratedFiles={recentGeneratedFiles}
            onSelectFile={handleSelectFile}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
            onRenameFile={handleRenameFile}
          />
        </Panel>

        <PanelResizeHandle className="w-1 bg-[#252526] hover:bg-indigo-500 transition-colors cursor-col-resize" />

        <Panel defaultSize={80} minSize={30}>
          <PanelGroup orientation="vertical">
            <Panel defaultSize={isActive && isTerminalVisible && terminalRef ? 70 : 100} minSize={20}>
              {editorPanel}
            </Panel>

            {isActive && isTerminalVisible && terminalRef && (
              <>
                <PanelResizeHandle className="h-1 bg-[#252526] hover:bg-indigo-500 transition-colors cursor-row-resize" />
                <Panel defaultSize={30} minSize={10}>
                  <div className="h-full bg-black flex flex-col">
                    <div className="flex items-center justify-between px-4 py-1.5 bg-[#1e1e1e] border-b border-[#3c3c3c]">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 flex items-center gap-2">
                        <Terminal className="w-3 h-3" />
                        Terminal
                      </div>
                    </div>
                    <div ref={terminalRef} className="flex-1 overflow-hidden p-2" />
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}
