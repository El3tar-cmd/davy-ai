import React, { useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { EmptyState } from './EmptyState';
import type { GenerationAgent, GenerationPhase, OllamaMessage } from '../../types';

interface ChatHistoryProps {
  messages: OllamaMessage[];
  isGenerating: boolean;
  generationPhase?: GenerationPhase;
  activeAgent?: GenerationAgent;
  onPromptSelect: (prompt: string) => void;
}

function getLoadingMessage(phase: GenerationPhase | undefined, agent: GenerationAgent | undefined) {
  if (phase === 'routing') return 'Lead Agent is selecting the right workflow...';
  if (phase === 'planning') return 'Planner Agent is defining the implementation strategy...';
  if (phase === 'building') return agent === 'builder' ? 'Builder Agent is generating files...' : 'Generating project...';
  if (phase === 'reviewing') return 'Reviewer Agent is checking architecture and risks...';
  if (phase === 'validating') return 'Running generation quality gates...';
  if (phase === 'fixing') return 'Fixer Agent is applying targeted repairs...';
  if (phase === 'failed') return 'Generation stopped on a quality failure.';
  return 'Analyzing request...';
}

export function ChatHistory({
  messages,
  isGenerating,
  generationPhase,
  activeAgent,
  onPromptSelect,
}: ChatHistoryProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const visibleMessages = messages.filter((message) => message.role !== 'system');

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {visibleMessages.length === 0 ? (
        <EmptyState onPromptSelect={onPromptSelect} />
      ) : (
        visibleMessages.map((message, index) => <ChatMessage key={index} message={message} />)
      )}
      {isGenerating && (
        <div className="flex items-start">
          <div className="bg-zinc-800 text-zinc-300 p-3 rounded-lg rounded-tl-none border border-zinc-700 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            {getLoadingMessage(generationPhase, activeAgent)}
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
