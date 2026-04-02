import React from 'react';
import { Database, CheckCircle, AlertCircle, Bot, ShieldAlert } from 'lucide-react';
import { ChatHeader } from './ChatHeader';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import type {
  Attachment,
  DatabaseProvider,
  GateResult,
  GenerationAgent,
  GenerationPhase,
  GenerationSummary,
  OllamaMessage,
  PreviewFrameRef,
  Project,
} from '../../types';

interface ChatSidebarProps {
  currentProject: Project;
  onOpenProjects: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearChat: () => void;
  onOpenSettings: () => void;
  messages: OllamaMessage[];
  isGenerating: boolean;
  isSearching: string | boolean;
  generationPhase?: GenerationPhase;
  activeAgent?: GenerationAgent;
  gateResults?: GateResult[];
  generationSummary?: GenerationSummary | null;
  onPromptSelect: (prompt: string) => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStopGeneration: () => void;
  selectedModel: string;
  isWebSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  isMultiAgentEnabled?: boolean;
  onToggleMultiAgent?: () => void;
  error: string | null;
  attachments: Attachment[];
  isProcessing?: boolean;
  onRemoveAttachment: (index: number) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  previewFrameRef: PreviewFrameRef;
  databaseProvider?: DatabaseProvider | null;
  isDatabaseConfigured?: boolean;
  isMobileMenuOpen: boolean;
  onCloseMobileMenu: () => void;
}

function getAgentLabel(agent: GenerationAgent | undefined) {
  if (agent === 'lead') return 'Lead';
  if (agent === 'planner') return 'Planner';
  if (agent === 'builder') return 'Builder';
  if (agent === 'reviewer') return 'Reviewer';
  return 'Idle';
}

export function ChatSidebar({
  currentProject,
  onOpenProjects,
  onUndo,
  onRedo,
  onClearChat,
  onOpenSettings,
  messages,
  isGenerating,
  isSearching,
  generationPhase,
  activeAgent,
  gateResults = [],
  generationSummary,
  onPromptSelect,
  input,
  onInputChange,
  onSend,
  onStopGeneration,
  selectedModel,
  isWebSearchEnabled,
  onToggleWebSearch,
  isMultiAgentEnabled,
  onToggleMultiAgent,
  error,
  attachments,
  isProcessing,
  onRemoveAttachment,
  onFileChange,
  fileInputRef,
  previewFrameRef,
  databaseProvider,
  isDatabaseConfigured,
  isMobileMenuOpen,
  onCloseMobileMenu,
}: ChatSidebarProps) {
  const databaseLabel = databaseProvider
    ? `${databaseProvider.charAt(0).toUpperCase()}${databaseProvider.slice(1)} Configured`
    : 'Not Configured';
  const failedGateCount = gateResults.filter((gate) => gate.status === 'fail').length;
  const warningGateCount = gateResults.filter((gate) => gate.status === 'warn').length;
  const blockerFailureCount = generationSummary?.blockerFailures ?? gateResults.filter((gate) => gate.status === 'fail' && gate.priority === 'blocker').length;
  const complianceFailureCount = generationSummary?.complianceFailures ?? gateResults.filter((gate) => gate.status === 'fail' && gate.priority === 'compliance').length;
  const executionModeLabel = generationSummary?.executionMode ?? (isMultiAgentEnabled ? 'multi-agent' : 'single-agent');
  const runtimeFailureCount = generationSummary?.runtimeFailures ?? 0;

  return (
    <>
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
          onClick={onCloseMobileMenu}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-40 w-80 md:w-full flex flex-col border-r border-zinc-800 bg-zinc-900/95 backdrop-blur-xl transform transition-transform duration-300 ease-in-out ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } md:relative md:translate-x-0 h-full`}
      >
        <ChatHeader
          currentProject={currentProject}
          onOpenProjects={onOpenProjects}
          onUndo={onUndo}
          onRedo={onRedo}
          onClearChat={onClearChat}
          onOpenSettings={onOpenSettings}
        />

        <div className="px-4 py-2 border-b border-zinc-800 flex flex-col gap-2 bg-zinc-900/50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <Database className="w-3 h-3" />
              Database
            </div>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
              isDatabaseConfigured
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {isDatabaseConfigured ? (
                <>
                  <CheckCircle className="w-2.5 h-2.5" />
                  {databaseLabel}
                </>
              ) : (
                <>
                  <AlertCircle className="w-2.5 h-2.5" />
                  Not Configured
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <CheckCircle className="w-3 h-3" />
              Multi-Agent
            </div>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
              isMultiAgentEnabled
                ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
            }`}>
              {isMultiAgentEnabled ? 'Active' : 'Disabled'}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <Bot className="w-3 h-3" />
              Orchestration
            </div>
            <div className="flex items-center gap-2 text-[9px] font-bold uppercase">
              <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300">
                {generationPhase || 'idle'}
              </span>
              <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-400">
                {getAgentLabel(activeAgent)}
              </span>
              <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-500">
                {executionModeLabel}
              </span>
            </div>
          </div>

          {(gateResults.length > 0 || generationSummary) && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <ShieldAlert className="w-3 h-3" />
                Quality Gates
              </div>
              <div className="flex flex-wrap gap-1.5 text-[9px] font-bold uppercase text-zinc-400">
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5">{failedGateCount} failed</span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5">{blockerFailureCount} blockers</span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5">{complianceFailureCount} compliance</span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5">{warningGateCount} warnings</span>
                {generationSummary && (
                  <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5">
                    {generationSummary.runtimeValidated ? `${runtimeFailureCount} runtime` : 'runtime pending'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <ChatHistory
          messages={messages}
          isGenerating={isGenerating}
          generationPhase={generationPhase}
          activeAgent={activeAgent}
          onPromptSelect={onPromptSelect}
        />

        <ChatInput
          input={input}
          onInputChange={onInputChange}
          onSend={onSend}
          isGenerating={isGenerating}
          isSearching={isSearching}
          generationPhase={generationPhase}
          activeAgent={activeAgent}
          gateResults={gateResults}
          generationSummary={generationSummary}
          onStopGeneration={onStopGeneration}
          selectedModel={selectedModel}
          isWebSearchEnabled={isWebSearchEnabled}
          onToggleWebSearch={onToggleWebSearch}
          isMultiAgentEnabled={isMultiAgentEnabled}
          onToggleMultiAgent={onToggleMultiAgent}
          error={error}
          attachments={attachments}
          isProcessing={isProcessing}
          onRemoveAttachment={onRemoveAttachment}
          onFileChange={onFileChange}
          fileInputRef={fileInputRef}
          previewFrameRef={previewFrameRef}
        />
      </div>
    </>
  );
}
