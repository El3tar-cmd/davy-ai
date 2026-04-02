import React, { RefObject } from 'react';
import { Loader2, Terminal as TerminalIcon } from 'lucide-react';
import type { ActiveTab, DevTarget, WorkspaceMode } from '../../types';

interface PreviewPanelProps {
  activeTab: ActiveTab;
  isSafeMode: boolean;
  isGenerating: boolean;
  iframeWidth: string;
  previewUrl: string;
  isBooting: boolean;
  terminalRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  workspaceMode: WorkspaceMode;
  devTargets: DevTarget[];
  activePreviewTargetLabel?: string | null;
}

export function PreviewPanel({
  activeTab,
  isSafeMode,
  isGenerating,
  iframeWidth,
  previewUrl,
  isBooting,
  terminalRef,
  iframeRef,
  workspaceMode,
  devTargets,
  activePreviewTargetLabel,
}: PreviewPanelProps) {
  return (
    <div
      className={`h-full transition-all duration-300 ease-in-out ${iframeWidth} bg-white rounded-lg shadow-2xl overflow-hidden border border-zinc-800 flex flex-col`}
    >
      <div className="h-8 bg-zinc-100 border-b border-zinc-200 flex items-center justify-between px-3 shrink-0 gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          {workspaceMode === 'paired' && (
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest truncate">
              {activePreviewTargetLabel ? `Preview: ${activePreviewTargetLabel}` : 'Paired Mode'}
            </span>
          )}
          {(isGenerating || isBooting) && <Loader2 className="w-3 h-3 animate-spin text-zinc-400 shrink-0" />}
          <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-widest shrink-0">
            DevHive Engine
          </span>
        </div>
      </div>

      {devTargets.length > 0 && (
        <div className="px-3 py-2 border-b border-zinc-200 bg-zinc-50 flex flex-wrap gap-2 shrink-0">
          {devTargets.map((target) => (
            <div
              key={target.manifestPath}
              className={`px-2 py-1 rounded-full text-[10px] font-medium border ${
                target.status === 'running'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : target.status === 'failed'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : target.status === 'installing' || target.status === 'starting'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-zinc-100 text-zinc-600 border-zinc-200'
              }`}
            >
              <span className="uppercase tracking-wide">{target.label}</span>
              <span className="ml-1 text-[9px] opacity-80">{target.role}</span>
              <span className="ml-1">{target.status}</span>
              {target.isPreviewTarget && <span className="ml-1 text-[9px] uppercase">preview</span>}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden relative bg-zinc-950">
        {isSafeMode && isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 text-zinc-400 p-8 text-center z-10">
            <Loader2 className="w-12 h-12 animate-spin mb-4 text-amber-500" />
            <h3 className="text-lg font-bold text-zinc-200 mb-2">Safe Mode Active</h3>
            <p className="text-sm max-w-xs">
              Preview is paused while generating to ensure system stability. It will resume
              once generation is complete.
            </p>
          </div>
        ) : null}

        <div className={`absolute inset-0 w-full h-full transition-opacity duration-200 ${
          activeTab === 'preview' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
        }`}>
          {previewUrl ? (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              title="Preview"
              className="w-full h-full border-0 bg-white"
              allow="cross-origin-isolated"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-400 p-6 text-center">
              {isGenerating && !isBooting ? (
                <>
                  <Loader2 className="w-10 h-10 animate-spin mb-4 text-amber-400" />
                  <p className="font-medium text-zinc-300">Processing Request...</p>
                  <p className="text-xs text-zinc-500 mt-2 max-w-xs">
                    The DevHive Engine is analyzing your input. If code is generated, the virtual OS will boot up automatically.
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="w-10 h-10 animate-spin mb-4 text-indigo-400" />
                  <p className="font-medium text-zinc-300">
                    {workspaceMode === 'paired' ? 'Starting paired development servers...' : 'Starting development server...'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-2">
                    Installing packages and booting the workspace.
                    <br />
                    Check the <strong>Console</strong> tab for live progress.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className={`absolute inset-0 w-full h-full flex flex-col bg-black transition-opacity duration-200 ${
          activeTab === 'console' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
        }`}>
          <div className="p-2 border-b border-zinc-800 bg-zinc-900 flex items-center gap-2 shrink-0">
            <TerminalIcon className="w-3 h-3 text-zinc-400" />
            <span className="text-[10px] text-zinc-400 font-mono uppercase">
              System Logs
            </span>
          </div>
          <div ref={terminalRef as any} className="flex-1 overflow-hidden p-2" />
        </div>
      </div>
    </div>
  );
}
