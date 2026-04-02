import { useState, useRef, useCallback, useEffect } from 'react';
import { generateProjectWithOrchestration } from '../utils/orchestration';
import type {
  Attachment,
  GateResult,
  GenerationAgent,
  GenerationPhase,
  GenerationSummary,
  OllamaMessage,
  Project,
  RuntimeValidationResult,
} from '../types';

interface UseChatOptions {
  messages: OllamaMessage[];
  files: Record<string, string>;
  endpoint: string;
  selectedModel: string;
  attachments: Attachment[];
  clearAttachments: () => void;
  updateCurrentProject: (updates: Partial<Project>) => void;
  pushToHistory: (messages: OllamaMessage[], files: Record<string, string>) => void;
  currentProjectName: string;
}

interface RunGenerationOptions {
  promptText: string;
  images?: string[];
  injectedFiles?: Record<string, string>;
  projectName: string;
  allowRuntimeAutoFix: boolean;
  clearComposerAfterStart?: boolean;
}

const RUNTIME_GATE_IDS = new Set(['runtime-preview-boot', 'runtime-preview-timeout', 'runtime-errors-detected']);

function buildGenerationInput(input: string, attachments: Attachment[]) {
  const imageAttachments = attachments.filter((attachment) => !attachment.isText);
  const textAttachments = attachments.filter((attachment) => attachment.isText);

  let promptText = textAttachments.length > 0
    ? `${input}${textAttachments
        .map((attachment) => `\n\n--- FILE: ${attachment.name} ---\n${attachment.textContent || ''}\n--- END FILE ---`)
        .join('')}`
    : input;

  const injectedFiles: Record<string, string> = {};
  if (imageAttachments.length > 0) {
    const imagePaths: string[] = [];
    imageAttachments.forEach((attachment, index) => {
      const fileName = attachment.name || `image_${index}.png`;
      const filePath = `public/${fileName}`;
      injectedFiles[filePath] = attachment.url; // Store dataUrl (which includes data:image/...;base64,)
      imagePaths.push(filePath);
    });
    
    promptText += `\n\n[Note: The user has uploaded the following images which are now available in the project. You can reference them directly in your code (e.g., <img src="/${imagePaths[0].replace('public/', '')}" />):\n${imagePaths.map(p => `- ${p}`).join('\n')}]`;
  }

  return {
    promptText,
    imageAttachments,
    injectedFiles,
  };
}

function createRuntimeGateResults(result: RuntimeValidationResult): GateResult[] {
  if (result.status === 'pass') {
    return [];
  }

  if (result.status === 'timeout') {
    return [
      {
        id: 'runtime-preview-timeout',
        status: 'fail',
        priority: 'blocker',
        scope: 'universal',
        title: 'Preview validation timed out',
        message: 'The preview did not become ready within the runtime validation window.',
        affectedFiles: [],
        autoFixHint: 'Check the dev script, entrypoints, and preview boot path before retrying runtime validation.',
      },
    ];
  }

  const gates: GateResult[] = [];

  if (!result.previewUrlPresent || result.bootPhase === 'error') {
    gates.push({
      id: 'runtime-preview-boot',
      status: 'fail',
      priority: 'blocker',
      scope: 'universal',
      title: 'Preview boot failed',
      message: 'The development preview did not reach a healthy ready state.',
      affectedFiles: [],
      autoFixHint: 'Repair the dev server boot path before validating runtime behavior again.',
    });
  }

  if (result.errors.length > 0) {
    const details = result.errors.slice(0, 3).join(' | ');
    gates.push({
      id: 'runtime-errors-detected',
      status: 'fail',
      priority: 'blocker',
      scope: 'universal',
      title: 'Runtime errors detected in preview',
      message: `The running app threw runtime errors after boot. ${details}${result.domSnapshot ? ' DOM snapshot was captured for debugging.' : ''}`,
      affectedFiles: [],
      autoFixHint: 'Fix the runtime exception paths that appear in the preview error report.',
    });
  }

  return gates;
}

function mergeRuntimeGateResults(gateResults: GateResult[], runtimeGates: GateResult[]) {
  return [...gateResults.filter((gate) => !RUNTIME_GATE_IDS.has(gate.id)), ...runtimeGates];
}

function patchGenerationSummary(summary: GenerationSummary, gateResults: GateResult[], runtime: RuntimeValidationResult): GenerationSummary {
  const passed = gateResults.filter((gate) => gate.status === 'pass').length;
  const warnings = gateResults.filter((gate) => gate.status === 'warn').length;
  const failed = gateResults.filter((gate) => gate.status === 'fail').length;
  const blockerFailures = gateResults.filter((gate) => gate.status === 'fail' && gate.priority === 'blocker').length;
  const complianceFailures = gateResults.filter((gate) => gate.status === 'fail' && gate.priority === 'compliance').length;
  const qualityWarnings = gateResults.filter((gate) => gate.status === 'warn' && gate.priority === 'quality').length;

  return {
    ...summary,
    passed,
    warnings,
    failed,
    blockerFailures,
    complianceFailures,
    qualityWarnings,
    runtimeValidated: true,
    runtimeFailures: runtime.errors.length + (runtime.status === 'pass' ? 0 : runtime.previewUrlPresent && runtime.bootPhase !== 'error' ? 0 : 1),
    previewBootPassed: runtime.previewUrlPresent && runtime.bootPhase !== 'error',
    requestResolved: blockerFailures === 0,
    projectClean: failed === 0,
  };
}

function shouldAttemptRuntimeAutoFix(summary: GenerationSummary | null) {
  return false; // Disabled per user request: "Automatic runtime validation detected unresolved preview failures. Fix only the runtime blockers without rewriting"
}

export function useChat({
  messages,
  files,
  endpoint,
  selectedModel,
  attachments,
  clearAttachments,
  updateCurrentProject,
  pushToHistory,
  currentProjectName,
}: UseChatOptions) {
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSearching, setIsSearching] = useState<string | boolean>(false);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [isMultiAgentEnabled, setIsMultiAgentEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>('idle');
  const [activeAgent, setActiveAgent] = useState<GenerationAgent>(null);
  const [gateResults, setGateResults] = useState<GateResult[]>([]);
  const [generationSummary, setGenerationSummary] = useState<GenerationSummary | null>(null);
  const [generationRunId, setGenerationRunId] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const liveMessagesRef = useRef<OllamaMessage[]>(messages);
  const liveFilesRef = useRef<Record<string, string>>(files);
  const gateResultsRef = useRef<GateResult[]>([]);
  const generationSummaryRef = useRef<GenerationSummary | null>(null);
  const currentRunIdRef = useRef(0);
  const runtimeValidationAppliedRunIdRef = useRef<number | null>(null);
  const runtimeAutoFixAllowedRef = useRef(false);
  const runtimeAutoFixTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isGenerating) {
      liveMessagesRef.current = messages;
      liveFilesRef.current = files;
    }
  }, [messages, files, isGenerating]);

  useEffect(() => {
    gateResultsRef.current = gateResults;
  }, [gateResults]);

  useEffect(() => {
    generationSummaryRef.current = generationSummary;
  }, [generationSummary]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setIsSearching(false);
      setGenerationPhase('idle');
      setActiveAgent(null);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const commitLiveProjectState = useCallback(
    (next: { messages?: OllamaMessage[]; files?: Record<string, string>; name?: string }) => {
      if (next.messages) {
        liveMessagesRef.current = next.messages;
      }
      if (next.files) {
        liveFilesRef.current = next.files;
      }

      updateCurrentProject({
        messages: liveMessagesRef.current,
        files: liveFilesRef.current,
        ...(next.name ? { name: next.name } : {}),
      });
    },
    [updateCurrentProject]
  );

  const runGeneration = useCallback(async ({
    promptText,
    images = [],
    injectedFiles = {},
    projectName,
    allowRuntimeAutoFix,
    clearComposerAfterStart = false,
  }: RunGenerationOptions) => {
    if (!promptText.trim() || !selectedModel) return;

    const baseMessages = liveMessagesRef.current.length > 0 ? liveMessagesRef.current : messages;
    const baseFiles = { ...liveFilesRef.current, ...injectedFiles };
    const userMsg: OllamaMessage = {
      role: 'user',
      content: promptText,
      ...(images.length > 0 ? { images } : {}),
    };
    const newMessages = [...baseMessages, userMsg];

    liveMessagesRef.current = newMessages;
    liveFilesRef.current = baseFiles;
    commitLiveProjectState({ messages: newMessages, files: baseFiles, name: projectName });

    if (clearComposerAfterStart) {
      setInput('');
      clearAttachments();
    }

    setIsGenerating(true);
    setError(null);
    setGenerationPhase('routing');
    setActiveAgent('lead');
    setIsSearching('Lead Agent is selecting the right workflow...');
    setGateResults([]);
    gateResultsRef.current = [];
    setGenerationSummary(null);
    generationSummaryRef.current = null;

    currentRunIdRef.current += 1;
    const runId = currentRunIdRef.current;
    setGenerationRunId(runId);
    runtimeValidationAppliedRunIdRef.current = null;
    runtimeAutoFixAllowedRef.current = allowRuntimeAutoFix;
    runtimeAutoFixTriggeredRef.current = false;

    abortControllerRef.current = new AbortController();

    try {
      const result = await generateProjectWithOrchestration({
        endpoint,
        selectedModel,
        input: promptText,
        existingMessages: newMessages,
        existingFiles: baseFiles,
        isWebSearchEnabled,
        isMultiAgentEnabled,
        signal: abortControllerRef.current?.signal,
        onMessagesUpdate: (nextMessages) => {
          commitLiveProjectState({ messages: nextMessages, name: projectName });
        },
        onFilesUpdate: (nextFiles) => {
          commitLiveProjectState({ files: nextFiles, name: projectName });
        },
        onStatusUpdate: ({ phase, agent, searching }) => {
          setGenerationPhase(phase);
          setActiveAgent(agent);
          setIsSearching(searching);
        },
      });

      setGateResults(result.gateResults);
      gateResultsRef.current = result.gateResults;
      setGenerationSummary(result.summary);
      generationSummaryRef.current = result.summary;
      liveMessagesRef.current = result.messages;
      liveFilesRef.current = result.files;
      pushToHistory(result.messages, result.files);

      if (result.gateResults.some((gate) => gate.status === 'fail')) {
        setError('Generation completed with unresolved quality gate failures. Review the gate report before اعتماد النتيجة.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        pushToHistory(liveMessagesRef.current, liveFilesRef.current);
      } else {
        setError(err?.message || 'Failed to connect to Ollama.');
        commitLiveProjectState({ messages: newMessages, files: liveFilesRef.current, name: projectName });
        setGenerationPhase('failed');
      }
    } finally {
      setIsGenerating(false);
      setIsSearching(false);
      abortControllerRef.current = null;
      setActiveAgent(null);
      setGenerationPhase((prev) => (prev === 'failed' ? 'failed' : 'completed'));
    }
  }, [
    selectedModel,
    messages,
    commitLiveProjectState,
    clearAttachments,
    endpoint,
    isWebSearchEnabled,
    isMultiAgentEnabled,
    pushToHistory,
  ]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() && attachments.length === 0) return;
    if (!selectedModel) return;

    const { promptText, imageAttachments, injectedFiles } = buildGenerationInput(input, attachments);
    const isFirstMessage = messages.length === 1 && messages[0].role === 'system';
    let newProjectName = currentProjectName;
    if (isFirstMessage) {
      const nameSource =
        promptText.trim() ||
        (attachments.length > 0 ? `Attachment: ${attachments[0].name || 'File'}` : 'New Project');
      newProjectName = nameSource.length > 30 ? `${nameSource.substring(0, 30)}...` : nameSource;
    }

    await runGeneration({
      promptText,
      images: imageAttachments.map((attachment) => attachment.base64),
      injectedFiles,
      projectName: newProjectName,
      allowRuntimeAutoFix: true,
      clearComposerAfterStart: true,
    });
  }, [attachments, currentProjectName, input, messages, runGeneration, selectedModel]);

  const runAutomatedRuntimeRepair = useCallback(async (runtimeResult: RuntimeValidationResult) => {
    const summary = generationSummaryRef.current;
    if (!summary || isGenerating || !shouldAttemptRuntimeAutoFix(summary)) return;

    const runtimeErrorText = runtimeResult.errors.length > 0
      ? runtimeResult.errors.join('\n')
      : runtimeResult.status === 'timeout'
        ? 'Preview validation timed out before the app became ready.'
        : 'Preview failed to boot after the latest generation.';

    const repairPrompt = `Automatic runtime validation detected unresolved preview failures. Fix only the runtime blockers without rewriting unrelated working code.\n\nOriginal workflow: ${summary.workflow}\nExecution mode: ${summary.executionMode}\nBoot phase: ${runtimeResult.bootPhase}\nPreview available: ${runtimeResult.previewUrlPresent ? 'yes' : 'no'}\n\nRuntime report:\n${runtimeErrorText}\n\n${runtimeResult.domSnapshot ? `DOM snapshot:\n${runtimeResult.domSnapshot}\n\n` : ''}Return concrete <file> or <edit> changes only.`;

    await runGeneration({
      promptText: repairPrompt,
      projectName: currentProjectName,
      allowRuntimeAutoFix: false,
    });
  }, [currentProjectName, isGenerating, runGeneration]);

  const applyRuntimeValidation = useCallback(async (result: RuntimeValidationResult) => {
    const runId = currentRunIdRef.current;
    if (runtimeValidationAppliedRunIdRef.current === runId) {
      return;
    }
    runtimeValidationAppliedRunIdRef.current = runId;

    const currentSummary = generationSummaryRef.current;
    if (!currentSummary) {
      return;
    }

    if (!shouldAttemptRuntimeAutoFix(currentSummary)) {
      return;
    }

    const runtimeGates = createRuntimeGateResults(result);
    const mergedGateResults = mergeRuntimeGateResults(gateResultsRef.current, runtimeGates);
    const nextSummary = patchGenerationSummary(currentSummary, mergedGateResults, result);

    setGateResults(mergedGateResults);
    gateResultsRef.current = mergedGateResults;
    setGenerationSummary(nextSummary);
    generationSummaryRef.current = nextSummary;

    if (runtimeGates.length === 0) {
      if (!mergedGateResults.some((gate) => gate.status === 'fail')) {
        setError(null);
      }
      return;
    }

    setError('Runtime validation detected preview blockers after generation. Review the runtime gate report before اعتماد النتيجة.');

    if (runtimeAutoFixAllowedRef.current && !runtimeAutoFixTriggeredRef.current && shouldAttemptRuntimeAutoFix(currentSummary)) {
      runtimeAutoFixTriggeredRef.current = true;
      await runAutomatedRuntimeRepair(result);
    }
  }, [isGenerating, runAutomatedRuntimeRepair]);

  return {
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
  };
}
