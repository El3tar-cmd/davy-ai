import { streamOllamaChat } from '../lib/ollama';
import { parseFilesFromStream, type ParserDiagnostics } from './file-parser';
import { SearchService, type SearchResult } from '../services/SearchService';
import { SYSTEM_PROMPT } from '../constants/system-prompt';
import { buildSpecFromPrompt } from './project-classifier';
import { getFailedGateSummary, summarizeGateResults } from './quality-gates';
import type {
  BuildSpec,
  ExecutionMode,
  GateResult,
  GenerationAgent,
  GenerationPhase,
  GenerationSummary,
  ReviewerFinding,
  ReviewerReport,
  RoutingDecision,
  WorkflowKind,
} from '../types';
import type { OllamaMessage } from '../lib/ollama';

interface GenerateProjectOptions {
  endpoint: string;
  selectedModel: string;
  input: string;
  existingMessages: OllamaMessage[];
  existingFiles: Record<string, string>;
  isWebSearchEnabled: boolean;
  isMultiAgentEnabled: boolean;
  signal?: AbortSignal;
  onMessagesUpdate: (messages: OllamaMessage[]) => void;
  onFilesUpdate: (files: Record<string, string>) => void;
  onStatusUpdate: (status: {
    phase: GenerationPhase;
    agent: GenerationAgent;
    searching: string | boolean;
  }) => void;
}

interface GenerateProjectResult {
  messages: OllamaMessage[];
  files: Record<string, string>;
  gateResults: GateResult[];
  summary: GenerationSummary;
  buildSpec: BuildSpec;
}

interface TaskBlock {
  taskLineIndex: number;
  title: string;
  assignedAgent?: string;
  fileLines: Array<{ index: number; path: string }>;
}

const MAX_FIX_ATTEMPTS = 10;
const PLAN_FILES = ['plan.md', 'structure.md', 'task.md'] as const;

function keepOnlyPlannerArtifacts(files: Record<string, string>) {
  return Object.fromEntries(
    PLAN_FILES.filter((file) => file in files).map((file) => [file, files[file]])
  ) as Record<string, string>;
}

function mergePlannerArtifacts(baseFiles: Record<string, string>, plannerFiles: Record<string, string>) {
  return {
    ...baseFiles,
    ...keepOnlyPlannerArtifacts(plannerFiles),
  };
}

function hasClosedPlannerArtifact(rawText: string, path: string) {
  const openTag = `<file path="${path}">`;
  const openIndex = rawText.indexOf(openTag);
  if (openIndex === -1) return false;

  return rawText.indexOf('</file>', openIndex + openTag.length) !== -1;
}

function shouldStopPlannerStream(rawText: string, files: Record<string, string>) {
  return PLAN_FILES.every((file) => file in files && hasClosedPlannerArtifact(rawText, file));
}

function getPlannerSummary(files: Record<string, string>) {
  const created = PLAN_FILES.filter((file) => file in files);
  if (created.length === PLAN_FILES.length) {
    return `**[Planner Agent]**\n\nCreated plan artifacts: ${created.join(', ')}`;
  }
  return '**[Planner Agent]**\n\nPreparing plan artifacts...';
}

function getPlanContext(files: Record<string, string>) {
  return [
    `plan.md:\n${files['plan.md'] || 'Missing'}`,
    `structure.md:\n${files['structure.md'] || 'Missing'}`,
    `task.md:\n${files['task.md'] || 'Missing'}`,
  ].join('\n\n');
}

function isTaskLine(line: string) {
  return /^- \[[ xX~]\] /.test(line.trim());
}

function isHeadingLine(line: string) {
  return /^#{1,6}\s/.test(line.trim());
}

function parseTaskBlocks(taskContent: string) {
  const lines = taskContent.split('\n');
  const blocks: TaskBlock[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^- \[[ xX~]\] (.+)$/);
    if (!match) continue;

    const block: TaskBlock = {
      taskLineIndex: i,
      title: match[1].trim(),
      fileLines: [],
    };

    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (isTaskLine(line) || isHeadingLine(line)) break;

      const agentMatch = line.match(/^\s*Assigned Agent:\s*(.+)$/i);
      if (agentMatch) {
        block.assignedAgent = agentMatch[1].trim();
      }

      const fileMatch = line.match(/^\s*- \[[ xX~]\] `([^`]+)`/);
      if (fileMatch) {
        block.fileLines.push({ index: j, path: fileMatch[1] });
      }
    }

    blocks.push(block);
  }

  return { lines, blocks };
}

function hasFileChanged(path: string, baselineFiles: Record<string, string>, currentFiles: Record<string, string>) {
  if (!(path in currentFiles)) return false;
  return baselineFiles[path] !== currentFiles[path];
}

function syncTaskChecklist(taskContent: string, baselineFiles: Record<string, string>, currentFiles: Record<string, string>) {
  if (!taskContent.trim()) return taskContent;

  const { lines, blocks } = parseTaskBlocks(taskContent);
  if (blocks.length === 0) return taskContent;

  const nextLines = [...lines];

  for (const block of blocks) {
    let changedCount = 0;

    for (const fileLine of block.fileLines) {
      const wasCompleted = lines[fileLine.index].includes('- [x]') || lines[fileLine.index].includes('- [X]');
      const isCompletedNow = hasFileChanged(fileLine.path, baselineFiles, currentFiles);
      const completed = wasCompleted || isCompletedNow;
      
      if (completed) changedCount += 1;
      nextLines[fileLine.index] = `  - [${completed ? 'x' : ' '}] \`${fileLine.path}\``;
    }

    let taskMarker = ' ';
    const wasTaskCompleted = lines[block.taskLineIndex].includes('- [x]') || lines[block.taskLineIndex].includes('- [X]');
    
    if (block.fileLines.length > 0) {
      if (changedCount === block.fileLines.length) {
        taskMarker = 'x';
      } else if (changedCount > 0) {
        taskMarker = '~';
      }
    } else if (wasTaskCompleted) {
      taskMarker = 'x';
    }

    nextLines[block.taskLineIndex] = `- [${taskMarker}] ${block.title}`;
  }

  return nextLines.join('\n');
}

function getChangedFiles(previousFiles: Record<string, string>, nextFiles: Record<string, string>) {
  return Object.keys(nextFiles).filter((file) => !(file in previousFiles) || previousFiles[file] !== nextFiles[file]);
}

function createNoOpBuilderGate(attemptCount: number): GateResult {
  return {
    id: `builder-noop-${attemptCount}`,
    status: 'fail',
    priority: 'blocker',
    scope: 'universal',
    title: 'Builder produced no file changes',
    message: 'The builder response did not apply any real file edits while critical gates were still failing.',
    affectedFiles: ['task.md'],
    autoFixHint: 'Apply concrete <file> or <edit> changes that resolve the failing code or structure issues.',
  };
}

const PLAN_ARTIFACT_SET = new Set<string>(PLAN_FILES);

function getFailedGateAffectedFiles(gateResults: GateResult[]) {
  return Array.from(
    new Set(
      gateResults
        .filter((gate) => gate.status === 'fail')
        .flatMap((gate) => gate.affectedFiles)
        .filter(Boolean)
    )
  );
}

function getNonPlanChangedFiles(previousFiles: Record<string, string>, nextFiles: Record<string, string>) {
  return getChangedFiles(previousFiles, nextFiles).filter((file) => !PLAN_ARTIFACT_SET.has(file));
}

function hasNonPlanFailures(gateResults: GateResult[]) {
  return gateResults.some(
    (gate) => gate.status === 'fail' && gate.affectedFiles.some((file) => !PLAN_ARTIFACT_SET.has(file))
  );
}

function createPaperworkOnlyBuilderGate(attemptCount: number, changedFiles: string[]): GateResult {
  return {
    id: `builder-paperwork-only-${attemptCount}`,
    status: 'fail',
    priority: 'blocker',
    scope: 'universal',
    title: 'Builder only changed planning artifacts',
    message: `The builder edited only planning files (${changedFiles.join(', ')}) while executable failures were still present.`,
    affectedFiles: [...PLAN_FILES],
    autoFixHint: 'Limit the builder to the failing implementation files and apply concrete code or config changes first.',
  };
}

function syncTaskFile(files: Record<string, string>, baselineFiles: Record<string, string>) {
  const taskContent = files['task.md'] || '';
  const nextTaskContent = syncTaskChecklist(taskContent, baselineFiles, files);
  if (!nextTaskContent || nextTaskContent === taskContent) {
    return files;
  }

  return {
    ...files,
    'task.md': nextTaskContent,
  };
}

function getExecutionMode(isMultiAgentEnabled: boolean): ExecutionMode {
  return isMultiAgentEnabled ? 'multi-agent' : 'single-agent';
}

const SHARED_AGENT_RULES = `Use <file> and <edit> tags only. Never answer with markdown code fences. 
CRITICAL: For existing files, you MUST use <edit> tags. Do NOT use <file> tags for existing files, as it will overwrite the entire file and delete unrelated code.
Use <file> tags ONLY for creating completely new files.
Prefer minimal, targeted edits when changing existing projects. Preserve unrelated working files unless a directly related change is required.`;

function getExecutionAgentPrompt(spec: BuildSpec, executionMode: ExecutionMode, workflow: WorkflowKind, plannerUsed: boolean, agentName: string = 'Builder') {
  const modeInstructions = plannerUsed
    ? 'The approved planning artifacts (`plan.md`, `structure.md`, `task.md`) are your ABSOLUTE CONSTITUTION. You MUST execute them with perfect precision and strict adherence. CRITICAL: DO NOT create, modify, or invent any files that are not explicitly assigned to you in `task.md`. DO NOT add extra features, files, or boilerplate not requested in the plan. Execute the plan to the letter. Your implementation must be flawless and exactly match the architecture provided.'
    : workflow === 'fix'
      ? 'Repair the existing project directly from the prompt and current project snapshot. Preserve unrelated working files and avoid broad rewrites.'
      : workflow === 'rebuild'
        ? 'Rebuild the requested project cleanly from the prompt and current snapshot, replacing only the scope required by the request.'
        : 'Implement the user request directly from the prompt and current project snapshot without inventing planning artifacts.';

  return `${SYSTEM_PROMPT}

You are the ${agentName} Agent. ${modeInstructions}

Execution mode: ${executionMode}
Workflow: ${workflow}
Project intent: ${spec.projectIntent}
Target surface: ${spec.targetSurface}
Repair strategy: ${spec.repairStrategy}
App kind: ${spec.appKind}
UI style: ${spec.uiStyle}
Features: ${spec.featureSet.join(', ') || 'standard'}
Acceptance checks: ${spec.acceptanceChecks.join('; ')}

${SHARED_AGENT_RULES}`;
}

function getReviewerPrompt(spec: BuildSpec, plannerUsed: boolean) {
  const scopeInstructions = plannerUsed
    ? 'Review the generated result against plan.md, structure.md, and task.md.'
    : 'Review the current project against the user request and the existing files only. Do not ask for planning artifacts and do not assume they should exist.';

  return `${SYSTEM_PROMPT}

You are the Reviewer Agent. ${scopeInstructions} Prioritize runtime and build blockers first, then plan compliance, then maintainability issues. Output JSON only with this exact shape:
{
  "runtimeBlockers": [{ "title": string, "message": string, "affectedFiles": string[] }],
  "buildBlockers": [{ "title": string, "message": string, "affectedFiles": string[] }],
  "complianceFailures": [{ "title": string, "message": string, "affectedFiles": string[] }],
  "qualityWarnings": [{ "title": string, "message": string, "affectedFiles": string[] }],
  "verdict": string
}
Return valid JSON only. Do not emit markdown, headings, or <file>/<edit> blocks in this phase.

Project intent: ${spec.projectIntent}
Target surface: ${spec.targetSurface}`;
}

function getSingleAgentUserContext(input: string, currentFiles: Record<string, string>) {
  return `User request:
${input}

Current files snapshot:
${JSON.stringify(currentFiles)}`;
}

function getMultiAgentUserContext(currentFiles: Record<string, string>) {
  return `Approved plan artifacts:

${getPlanContext(currentFiles)}

Current files snapshot:
${JSON.stringify(currentFiles)}

IMPORTANT: Complete the task.md file checklist by implementing the referenced files. Preserve task.md structure so the orchestrator can mark file completion automatically.`;
}

function getFixUserContext(input: string, currentFiles: Record<string, string>) {
  return `User request:
${input}

Fix the existing project with the smallest concrete edit set needed. Preserve unrelated working files.

Current files snapshot:
${JSON.stringify(currentFiles)}`;
}

function getFilesRevision(files: Record<string, string>) {
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  let hash = 2166136261;

  for (const [path, content] of entries) {
    const value = `${path}\0${content}\u0001`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }

  return `r${(hash >>> 0).toString(36)}-${entries.length}`;
}

function getReviewerUserContext(input: string, currentFiles: Record<string, string>, plannerUsed: boolean, revision: string) {
  const fileTree = Object.keys(currentFiles).sort().join('\n');
  return plannerUsed
    ? `Workspace revision: ${revision}

User request:
${input}

Approved plan artifacts:

${getPlanContext(currentFiles)}

File structure:
${fileTree}

Generated files content:
${JSON.stringify(currentFiles)}`
    : `Workspace revision: ${revision}

User request:
${input}

File structure:
${fileTree}

Current files snapshot content:
${JSON.stringify(currentFiles)}`;
}

function createEmptyReviewerReport(): ReviewerReport {
  return {
    runtimeBlockers: [],
    buildBlockers: [],
    complianceFailures: [],
    qualityWarnings: [],
    verdict: '',
  };
}

function normalizeReviewerFindings(value: unknown): ReviewerFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const finding = item as Record<string, unknown>;
      return {
        title: typeof finding.title === 'string' ? finding.title.trim() : '',
        message: typeof finding.message === 'string' ? finding.message.trim() : '',
        affectedFiles: Array.isArray(finding.affectedFiles) ? finding.affectedFiles.filter((file): file is string => typeof file === 'string') : [],
      } satisfies ReviewerFinding;
    })
    .filter((finding): finding is ReviewerFinding => Boolean(finding && finding.title && finding.message));
}

function parseReviewerReport(cleanText: string): ReviewerReport | null {
  const jsonText = cleanText.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      runtimeBlockers: normalizeReviewerFindings(parsed.runtimeBlockers),
      buildBlockers: normalizeReviewerFindings(parsed.buildBlockers),
      complianceFailures: normalizeReviewerFindings(parsed.complianceFailures),
      qualityWarnings: normalizeReviewerFindings(parsed.qualityWarnings),
      verdict: typeof parsed.verdict === 'string' ? parsed.verdict.trim() : '',
    };
  } catch (_error) {
    return null;
  }
}

function formatReviewerReport(report: ReviewerReport) {
  const formatSection = (title: string, findings: ReviewerFinding[]) => {
    if (findings.length === 0) return `${title}
- none`;
    return `${title}
${findings.map((finding) => `- ${finding.title}: ${finding.message}`).join('\n')}`;
  };

  return [
    '**[Reviewer Agent]**',
    '',
    formatSection('Runtime Blockers', report.runtimeBlockers),
    '',
    formatSection('Build Blockers', report.buildBlockers),
    '',
    formatSection('Compliance Gaps', report.complianceFailures),
    '',
    formatSection('Quality Notes', report.qualityWarnings),
    '',
    `Verdict\n${report.verdict || 'No verdict provided.'}`,
  ].join('\n');
}

function createParserFailureGates(diagnostics: ParserDiagnostics, phase: 'builder'): GateResult[] {
  if (diagnostics.failedEditCount === 0) return [];

  return [
    {
      id: `${phase}-edit-application-failed`,
      status: 'fail',
      priority: 'blocker',
      scope: 'universal',
      title: `Builder emitted unapplied edits`,
      message: `One or more <edit> operations could not be applied cleanly. Affected files: ${diagnostics.failedEditFiles.join(', ')}.`,
      affectedFiles: diagnostics.failedEditFiles,
      autoFixHint: 'CRITICAL: Your previous <edit> failed because the <search> block did not EXACTLY match the file content. You MUST copy the exact lines from the current file snapshot, including all whitespace and indentation. Do NOT use <file> tags to overwrite existing files.',
    },
  ];
}

function dedupeGateResults(gateResults: GateResult[]) {
  const seen = new Set<string>();
  return gateResults.filter((gate) => {
    const key = `${gate.id}:${gate.title}:${gate.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runExecutionGates(
  files: Record<string, string>,
  spec: BuildSpec,
  executionMode: ExecutionMode,
  diagnostics: ParserDiagnostics,
  phase: 'builder',
  requirePlanArtifacts = executionMode === 'multi-agent'
) {
  return dedupeGateResults([
    ...createParserFailureGates(diagnostics, phase),
  ]);
}

function hasBlockingFailures(gateResults: GateResult[]) {
  return gateResults.some((gate) => gate.status === 'fail' && gate.priority === 'blocker');
}

function extractReviewerSection(summary: string, heading: string, nextHeading: string[]) {
  const lines = summary.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (startIndex === -1) return '';

  const collected: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (nextHeading.some((candidate) => line.trim().toLowerCase() === candidate.toLowerCase())) {
      break;
    }
    collected.push(line);
  }

  return collected.join('\n').trim();
}

function isMeaningfulReviewerSection(section: string) {
  if (!section) return false;
  const normalized = section.toLowerCase();
  return !['none', 'n/a', 'no issues', 'no blockers', 'no gaps', 'no critical runtime blockers found.'].includes(normalized);
}

function createReviewerDerivedGates(reviewerReport: ReviewerReport): GateResult[] {
  const gates: GateResult[] = [];

  for (const finding of [...reviewerReport.runtimeBlockers, ...reviewerReport.buildBlockers]) {
    gates.push({
      id: `reviewer-runtime-${finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      status: 'fail',
      priority: 'blocker',
      scope: 'universal',
      title: finding.title,
      message: finding.message,
      affectedFiles: finding.affectedFiles,
      autoFixHint: 'Address the reviewer-reported runtime/build blocker before accepting the project.',
    });
  }

  for (const finding of reviewerReport.complianceFailures) {
    gates.push({
      id: `reviewer-compliance-${finding.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      status: 'fail',
      priority: 'compliance',
      scope: 'universal',
      title: finding.title,
      message: finding.message,
      affectedFiles: finding.affectedFiles,
      autoFixHint: 'Bring the generated files back in line with the requested structure and reviewer findings.',
    });
  }

  return gates;
}

function hasExistingProjectFiles(files: Record<string, string>) {
  return Object.keys(files).some((file) => !PLAN_ARTIFACT_SET.has(file));
}

function inferRoutingDecision(input: string, existingFiles: Record<string, string>, executionMode: ExecutionMode): RoutingDecision {
  const normalized = input.toLowerCase();
  const hasProject = hasExistingProjectFiles(existingFiles);
  const wantsRebuild = /(from scratch|start over|rebuild|regenerate|rewrite everything|ابدأ من جديد|اعادة بناء|إعادة بناء)/i.test(input);
  const wantsInspectOnly = /(inspect only|review only|audit only|فحص فقط|راجع فقط|بدون تعديل|without changes?)/i.test(input);
  const wantsReview = /(افحص|فحص|راجع|مراجعة|دقق|audit|inspect|review|analy[sz]e|diagnos|quality check|code review)/i.test(input);
  const wantsFix = /(اصلح|إصلح|اصلاح|إصلاح|تصليح|حل|لا يعمل|لا تعمل|مش شغال|مش شغالة|لا يشتغل|لا تشتغل|مش بيشتغل|does not work|doesn't work|not working|broken|fix|repair|resolve|debug|bug|errors?|issues?|عيد|اعد|إعد|أعد|أصلح|صلح)/i.test(input);
  const wantsResume = /(resume|continue|finish|keep going|complete|task\.?md|tasks?|كمل|استكمل|استمر|باقي|خلص|أكمل|اكمل)/i.test(input);
  const isQuestionOrResearch = /^[^a-zA-Z0-9\u0600-\u06FF]*(what|how|why|when|where|who|explain|tell me|search|research|ما|كيف|لماذا|متى|اين|من|اشرح|قل لي|ابحث|بحث|هل)/i.test(input.trim()) 
    && !/(build|create|make|generate|app|project|website|ابني|اصنع|انشئ|اعمل|تطبيق|مشروع)/i.test(input);

  let workflow: WorkflowKind = 'build';
  const hasTasks = !!existingFiles['task.md'];

  if (wantsRebuild) {
    workflow = 'rebuild';
  } else if (hasProject && wantsResume && hasTasks) {
    workflow = 'resume';
  } else if (hasProject && wantsInspectOnly) {
    workflow = 'inspect';
  } else if (hasProject && wantsReview && !wantsFix) {
    workflow = 'review';
  } else if (hasProject && (wantsFix || (wantsResume && !hasTasks))) {
    workflow = 'fix';
  } else if (isQuestionOrResearch) {
    workflow = 'chat';
  }

  if (!hasProject && (workflow === 'review' || workflow === 'inspect' || workflow === 'fix' || workflow === 'resume')) {
    workflow = 'build';
  }

  const needsPlanner = (executionMode === 'multi-agent' && (workflow === 'build' || workflow === 'rebuild'))
    || (workflow === 'resume' && !hasTasks); // Fallback if task.md missing

  const targetAgent: GenerationAgent = workflow === 'build' || workflow === 'rebuild'
    ? (needsPlanner ? 'planner' : 'builder')
    : workflow === 'chat'
      ? 'assistant'
      : workflow === 'resume'
        ? 'builder'
        : workflow === 'fix'
          ? (executionMode === 'multi-agent' ? 'reviewer' : 'builder')
          : (executionMode === 'multi-agent' ? 'reviewer' : null);

  const reason = workflow === 'build' || workflow === 'rebuild'
    ? hasProject && normalized.includes('rebuild') ? 'Existing project requires a rebuild workflow.' : 'Request is primarily asking for implementation work.'
    : workflow === 'resume'
      ? 'User wants to continue or resume from the existing task list.'
      : workflow === 'chat'
        ? 'User is asking a general question or requesting research, not building an app.'
        : workflow === 'fix'
          ? 'Existing project files are present and the request is asking for targeted fixes.'
          : 'Existing project files are present and the request is asking for inspection or review.';

  return {
    workflow,
    needsPlanner,
    targetAgent,
    shouldPreserveFiles: workflow !== 'rebuild',
    reason,
  };
}

function normalizeRoutingDecision(candidate: Partial<RoutingDecision>, fallback: RoutingDecision, executionMode: ExecutionMode, existingFiles: Record<string, string>): RoutingDecision {
  const allowedWorkflows: WorkflowKind[] = ['build', 'review', 'fix', 'inspect', 'rebuild', 'chat'];
  let workflow = allowedWorkflows.includes(candidate.workflow as WorkflowKind) ? candidate.workflow as WorkflowKind : fallback.workflow;
  const hasProject = hasExistingProjectFiles(existingFiles);

  // When the deterministic fallback sees a fix request on an existing project, do not allow the model to reroute it into review/inspect/build planning.
  if (fallback.workflow === 'fix' && (workflow === 'review' || workflow === 'inspect' || workflow === 'build' || workflow === 'rebuild')) {
    workflow = 'fix';
  }

  if (!hasProject && (workflow === 'review' || workflow === 'inspect' || workflow === 'fix')) {
    workflow = 'build';
  }

  const needsPlanner = executionMode === 'multi-agent' && (candidate.needsPlanner ?? fallback.needsPlanner) && (workflow === 'build' || workflow === 'rebuild');
  const targetAgent = workflow === 'build' || workflow === 'rebuild'
    ? needsPlanner ? 'planner' : 'builder'
    : workflow === 'chat'
      ? 'assistant'
      : workflow === 'fix'
        ? executionMode === 'multi-agent' ? 'reviewer' : 'builder'
        : executionMode === 'multi-agent' ? 'reviewer' : null;

  return {
    workflow,
    needsPlanner,
    targetAgent,
    shouldPreserveFiles: typeof candidate.shouldPreserveFiles === 'boolean' ? candidate.shouldPreserveFiles : workflow !== 'rebuild',
    reason: typeof candidate.reason === 'string' && candidate.reason.trim() ? candidate.reason.trim() : fallback.reason,
  };
}

async function routeRequestWithLeadAgent(params: {
  endpoint: string;
  selectedModel: string;
  input: string;
  currentFiles: Record<string, string>;
  executionMode: ExecutionMode;
  signal?: AbortSignal;
}) {
  const fallback = inferRoutingDecision(params.input, params.currentFiles, params.executionMode);

  try {
    const response = await fetch(`${params.endpoint.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.selectedModel,
        prompt: `You are the Lead Agent for an app-building workflow. Decide the workflow for the request. Output JSON only with keys workflow, needsPlanner, targetAgent, shouldPreserveFiles, reason.

Allowed workflow values: build, review, fix, inspect, rebuild, chat.
Allowed targetAgent values: planner, builder, reviewer, assistant, lead, null.

Rules:
1. If the user asks to build a new feature or app, choose 'build'.
2. If the user asks to fix a bug or error, choose 'fix'. Target agent should be 'builder'.
3. If the user asks to review or inspect existing code, choose 'review' or 'inspect'. Target agent should be 'reviewer'.
4. If the user asks to start over, choose 'rebuild'.
5. If the user asks a general question, wants an explanation, or requests research WITHOUT asking to build a new app, choose 'chat'. Target agent should be 'assistant'.
6. Only use 'planner' as targetAgent if execution mode is 'multi-agent' and workflow is 'build' or 'rebuild'. Otherwise, use 'builder' for 'build'/'fix' and 'reviewer' for 'review'/'inspect'.

Execution mode: ${params.executionMode}
User request:
${params.input}

Current file paths:
${Object.keys(params.currentFiles).sort().slice(0, 200).join('\n') || '(none)'}`,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 160 },
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      return fallback;
    }

    const data = await response.json();
    const raw = typeof data.response === 'string' ? data.response : '';
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) {
      return fallback;
    }

    const parsed = JSON.parse(jsonText) as Partial<RoutingDecision>;
    return normalizeRoutingDecision(parsed, fallback, params.executionMode, params.currentFiles);
  } catch (_error) {
    return fallback;
  }
}

/** Extract meaningful search keywords from user input without an LLM call. */
function extractSearchKeywords(input: string): string {
  return input
    .replace(/--- FILE:[\s\S]*?--- END FILE ---/g, ' ')
    .replace(/<file[\s\S]*?<\/file>/g, ' ')
    .replace(/<edit[\s\S]*?<\/edit>/g, ' ')
    .replace(/\b(what|how|why|when|where|who|explain|tell me|search|research|ما|كيف|لماذا|متى|اين|من|اشرح|قل لي|ابحث|عن|بحث|هل|please|can you|i want|i need|make me|create|build|generate|اعمل|عايز|محتاج|ممكن)\b/gi, ' ')
    .replace(/["']/g, '') // Remove quotes to avoid exact string matching which yields 0 results
    .replace(/[<>{}[\]`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function runSearchIfNeeded(
  _endpoint: string,
  _selectedModel: string,
  input: string,
  enabled: boolean,
  onStatus?: (msg: string) => void,
): Promise<{ text: string; results: SearchResult[]; query: string; provider: string }> {
  const empty = { text: '', results: [], query: '', provider: '' };
  if (!enabled) return empty;

  const query = extractSearchKeywords(input);
  if (!query || query.length < 3) return empty;

  onStatus?.(`Searching for "${query}"...`);

  try {
    const outcome = await SearchService.searchDetailed(query);
    if (outcome.ok && outcome.results.length > 0) {
      onStatus?.(`Search complete (${outcome.results.length} results via ${outcome.provider})`);
      const formatted = [
        `[Web Search: "${query}" — ${outcome.results.length} results via ${outcome.provider}${outcome.cached ? ' (cached)' : ''}]`,
        ...outcome.results.map((r, i) => `${i + 1}. ${r.title} | ${r.source}\n   ${r.url}\n   ${r.snippet}`),
        '[End Search]'
      ].join('\n');
      
      return { text: formatted, results: outcome.results, query, provider: outcome.provider };
    } else {
      onStatus?.('No search results found');
    }
    return { text: `[Web Search: "${query}" — no results available]`, results: [], query, provider: 'none' };
  } catch (err) {
    console.warn('[Search] Search failed:', err);
    onStatus?.('Search unavailable');
    return empty;
  }
}

async function streamSingleAgent(params: {
  endpoint: string;
  model: string;
  messages: OllamaMessage[];
  signal?: AbortSignal;
  baselineFiles: Record<string, string>;
  messagePrefix?: string;
  shouldStop?: (
    text: string,
    generatedFiles: Record<string, string>,
    cleanText: string,
    diagnostics: ParserDiagnostics
  ) => boolean;
  onPartialText: (
    text: string,
    generatedFiles: Record<string, string>,
    cleanText: string,
    diagnostics: ParserDiagnostics
  ) => void;
}) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) {
      controller.abort();
    } else {
      params.signal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  const stream = streamOllamaChat(params.endpoint, params.model, params.messages, controller.signal);
  let rawText = '';
  let latestFiles = { ...params.baselineFiles };
  let latestCleanText = '';
  let latestDiagnostics: ParserDiagnostics = {
    failedEditCount: 0,
    failedEditFiles: [],
    overwrittenExistingFiles: [],
    editResults: [],
  };

  try {
    for await (const chunk of stream) {
      rawText += chunk;
      const { files, cleanText, diagnostics } = parseFilesFromStream(rawText, latestFiles);
      latestFiles = { ...latestFiles, ...files };
      latestCleanText = `${params.messagePrefix || ''}${cleanText}`.trim();
      latestDiagnostics = diagnostics;
      params.onPartialText(rawText, latestFiles, latestCleanText, latestDiagnostics);

      if (params.shouldStop?.(rawText, latestFiles, latestCleanText, latestDiagnostics)) {
        controller.abort();
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
  } finally {
    params.signal?.removeEventListener('abort', abortFromParent);
  }

  return { text: rawText, files: latestFiles, cleanText: latestCleanText, diagnostics: latestDiagnostics };
}

function sanitizeAgentOutput(text: string): string {
  if (!text) return '';
  
  return text
    // Strip "Generated Files:" and the following list until some code tag or empty line
    .replace(/^Generated Files:\s*(\n\s*[-*]\s*.*)*/gim, '')
    // Strip "Executing: Task \d+:"
    .replace(/Executing: Task \d+:[^\n]*/gi, '')
    // Strip "[Frontend Agent]", "[Reviewer Agent]", etc.
    .replace(/\[(Lead|Planner|Builder|Reviewer|Fixer|Frontend|Backend|Quality)\s*Agent\]/gi, '')
    // Strip "Reviewer report:" followed by JSON
    .replace(/Reviewer report:\s*\{[\s\S]*?\}/gi, '')
    // Strip standalone ellipses often used as placeholders
    .replace(/^\.\.\.\s*$/gm, '')
    .trim();
}

export async function generateProjectWithOrchestration({
  endpoint,
  selectedModel,
  input,
  existingMessages,
  existingFiles,
  isWebSearchEnabled,
  isMultiAgentEnabled,
  signal,
  onMessagesUpdate,
  onFilesUpdate,
  onStatusUpdate,
}: GenerateProjectOptions): Promise<GenerateProjectResult> {
  const executionMode = getExecutionMode(isMultiAgentEnabled);
  let chatMessages = [...existingMessages];
  let currentFiles = { ...existingFiles };
  
  if (isWebSearchEnabled) {
    onStatusUpdate({ phase: 'routing', agent: 'lead', searching: true });
  }

  const searchOutcome = await runSearchIfNeeded(
    endpoint,
    selectedModel,
    input,
    isWebSearchEnabled,
    (msg: string) => onStatusUpdate({ phase: 'routing', agent: 'lead', searching: msg })
  );
  const searchContext = searchOutcome.text;

  let routingDecision = inferRoutingDecision(input, currentFiles, executionMode);
  if (executionMode === 'multi-agent' && routingDecision.workflow !== 'chat') {
    onStatusUpdate({ phase: 'routing', agent: 'lead', searching: 'Lead Agent is selecting the right workflow...' });
    routingDecision = await routeRequestWithLeadAgent({
      endpoint,
      selectedModel,
      input,
      currentFiles,
      executionMode,
      signal,
    });
  }

  const workflow = routingDecision.workflow;
  const plannerUsed = executionMode === 'multi-agent' && routingDecision.needsPlanner;
  let plannerNotes = '';
  let executionBaselineFiles = { ...existingFiles };

  const emptyDiagnostics: ParserDiagnostics = {
    failedEditCount: 0,
    failedEditFiles: [],
    overwrittenExistingFiles: [],
    editResults: [],
  };

  const addSearchContext = (messages: OllamaMessage[]) => {
    if (!searchContext) return messages;

    // Inject search context right after the first system message if one exists,
    // otherwise add it as a new system message at the beginning.
    const systemIndex = messages.findIndex(m => m.role === 'system');
    const researchMessage: OllamaMessage = {
      role: 'system',
      content: `[Web Research Results]\n${searchContext}\n[End Research]`
    };

    if (systemIndex >= 0) {
      const newMessages = [...messages];
      newMessages.splice(systemIndex + 1, 0, researchMessage);
      return newMessages;
    }
    
    return [researchMessage, ...messages];
  };

  const runPlannerPhase = async () => {
    onStatusUpdate({ phase: 'planning', agent: 'planner', searching: false });

    const plannerMessages = addSearchContext([
      {
        role: 'system' as const,
        content: `${SYSTEM_PROMPT}

You are the Lead Solutions Architect and Planner Agent. Before any implementation starts, create exactly three planning files using <file> tags only:
1. plan.md
2. structure.md
3. task.md

CRITICAL: DO NOT CREATE ANY OTHER FILES. You are ONLY allowed to create these three planning files. Do not write any code for the actual application.

Your task is to design a highly professional, extensive, and advanced architecture. Make your plan EXTREMELY detailed, robust, and comprehensive. Do not make weak, brief, or generic plans. Include all necessary components, utilities, configurations, state management, and styling files required for a production-grade application. The execution agents will strictly follow your plan to the letter, so if you miss a file, it will not be built.

plan.md must contain these headings exactly:
# Implementation Plan
## App Kind
## Goals
## Architecture (Detailed and professional)
## Required Agents (Choose from: Frontend, Backend, Database, Documentation)
## Acceptance Criteria

structure.md must contain these headings exactly:
# Project Structure
## File Tree (Exhaustive list of all files)
## Required Files

task.md must contain these headings exactly:
# Task List
## Execution Steps

Inside task.md, write comprehensive and detailed top-level tasks using this exact pattern:
- [ ] Task title
  Assigned Agent: [Agent Name]
  Files:
  - [ ] \`path/to/file.ext\`
  - [ ] \`another/file.ext\`
  Done when: one short acceptance line

Every single implementation file listed in structure.md MUST appear under exactly one task file checklist. Do not emit any free-form explanation outside the three file tags.`,
      },
      ...chatMessages.filter((message) => message.role !== 'system'),
    ]);

    const plannerIndex = chatMessages.length;
    chatMessages = [...chatMessages, { role: 'assistant', content: '' }];
    onMessagesUpdate(chatMessages);

    const plannerResult = await streamSingleAgent({
      endpoint,
      model: selectedModel,
      messages: plannerMessages,
      signal,
      baselineFiles: currentFiles,
      shouldStop: (rawText, generatedFiles) => shouldStopPlannerStream(rawText, keepOnlyPlannerArtifacts(generatedFiles)),
      onPartialText: (_rawText, generatedFiles) => {
        currentFiles = mergePlannerArtifacts(existingFiles, generatedFiles);
        onFilesUpdate(currentFiles);
        plannerNotes = currentFiles['plan.md'] || '';
        chatMessages[plannerIndex] = {
          role: 'assistant',
          content: getPlannerSummary(currentFiles),
          filesGenerated: PLAN_FILES.filter((file) => file in currentFiles),
        };
        onMessagesUpdate([...chatMessages]);
      },
    });

    currentFiles = mergePlannerArtifacts(existingFiles, plannerResult.files);
    onFilesUpdate(currentFiles);
    plannerNotes = currentFiles['plan.md'] || '';
    executionBaselineFiles = { ...currentFiles };
    currentFiles = syncTaskFile(currentFiles, executionBaselineFiles);
    onFilesUpdate(currentFiles);
    chatMessages[plannerIndex] = {
      role: 'assistant',
      content: getPlannerSummary(currentFiles),
      filesGenerated: PLAN_FILES.filter((file) => file in currentFiles),
    };
    onMessagesUpdate([...chatMessages]);
  };

  if (plannerUsed) {
    await runPlannerPhase();
  }

  const buildSpec = buildSpecFromPrompt(input, currentFiles, plannerNotes);

  const runExecutionPass = async (
    builderWorkflow: WorkflowKind,
    baselineFilesOverride?: Record<string, string>,
    userContextOverride?: string
  ) => {
    let finalDiagnostics: ParserDiagnostics = {
      failedEditCount: 0,
      failedEditFiles: [],
      overwrittenExistingFiles: [],
      editResults: [],
    };

    if (builderWorkflow === 'chat') {
      onStatusUpdate({
        phase: 'chatting',
        agent: 'assistant',
        searching: searchOutcome.results.length > 0 
          ? `Found ${searchOutcome.results.length} sources...` 
          : 'Synthesizing response...',
      });

      // 1. If we have search results, inject a "Research Summary" message FIRST
      if (searchOutcome.results.length > 0) {
        const researchSummary = `🔍 **Researching:** "${searchOutcome.query}"\n\nI've gathered the latest information from **${searchOutcome.provider}**. Here are the primary sources I'm using for this answer:\n\n` +
          searchOutcome.results.map(r => `*   **${r.title}**\n    [${r.url}](${r.url})`).join('\n') +
          `\n\n---\n\n*Synthesizing the results to answer your question...*`;

        chatMessages = [...chatMessages, { role: 'assistant', content: researchSummary }];
        onMessagesUpdate(chatMessages);
      }

      const hasResearch = !!searchContext;
      const researchPrompt = hasResearch 
        ? `You are a helpful AI coding assistant and researcher. You have just been provided with up-to-date web research results in the system message. \nCRITICAL RULES:\n1. Open your response by acknowledging that you are synthesizing the research results found above.\n2. Answer the user's question accurately using ONLY the provided research if it is relevant. Do not rely solely on your generic training data.\n3. Make your answer structured, professional, and detailed.\n4. DO NOT attempt to write or create an application framework, DO NOT output any <file> or <edit> tags.`
        : `You are a helpful AI coding assistant and researcher. Answer the user's question, summarize your findings, or explain concepts. \nCRITICAL: DO NOT attempt to write or create an application framework, DO NOT output any <file> or <edit> tags, and DO NOT generate React components unless the user EXPLICITLY asks for a code snippet.`;

      const chatResultMessages = addSearchContext([
        { role: 'system' as const, content: `${SYSTEM_PROMPT}\n\n${researchPrompt}` },
        ...chatMessages.filter((message) => message.role !== 'system')
      ]);

      const chatIndex = chatMessages.length;
      chatMessages = [...chatMessages, { role: 'assistant', content: '' }];
      onMessagesUpdate(chatMessages);

      const chatResult = await streamSingleAgent({
        endpoint,
        model: selectedModel,
        messages: chatResultMessages,
        signal,
        baselineFiles: currentFiles,
        onPartialText: (_rawText, _generatedFiles, cleanText) => {
          chatMessages[chatIndex] = {
            role: 'assistant',
            content: cleanText,
            filesGenerated: [],
          };
          onMessagesUpdate([...chatMessages]);
        },
      });

      onStatusUpdate({
        phase: 'completed',
        agent: 'assistant',
        searching: false,
      });

      return { files: currentFiles, diagnostics: finalDiagnostics };
    }

    if (plannerUsed) {
      const taskContent = currentFiles['task.md'] || '';
      const { blocks, lines } = parseTaskBlocks(taskContent);

      for (const block of blocks) {
        // Check if task is already completed based on task.md markers
        const isTaskMarkedCompleted = lines[block.taskLineIndex] && (lines[block.taskLineIndex].includes('- [x]') || lines[block.taskLineIndex].includes('- [X]'));
        
        let changedCount = 0;
        for (const fileLine of block.fileLines) {
          const isFileMarkedCompleted = lines[fileLine.index] && (lines[fileLine.index].includes('- [x]') || lines[fileLine.index].includes('- [X]'));
          if (isFileMarkedCompleted || hasFileChanged(fileLine.path, executionBaselineFiles, currentFiles)) {
            changedCount += 1;
          }
        }
        
        if (isTaskMarkedCompleted || (block.fileLines.length > 0 && changedCount === block.fileLines.length)) {
          continue; // Task already completed
        }

        const agentName = block.assignedAgent || 'Builder';
        const agentId = agentName.toLowerCase() as GenerationAgent;

        onStatusUpdate({
          phase: 'building',
          agent: agentId,
          searching: `Lead Agent assigned task "${block.title}" to ${agentName} Agent...`,
        });

        const executionMessages = addSearchContext([
          { role: 'system' as const, content: getExecutionAgentPrompt(buildSpec, executionMode, builderWorkflow, plannerUsed, agentName) },
          ...chatMessages.filter((message) => message.role !== 'system'),
          {
            role: 'user' as const,
            content: `Task to execute: ${block.title}
Assigned Agent: ${agentName}

${getMultiAgentUserContext(currentFiles)}`,
          },
        ]);

        const baselineFiles = baselineFilesOverride ?? currentFiles;
        const executionIndex = chatMessages.length;
        chatMessages = [...chatMessages, { role: 'assistant', content: '' }];
        onMessagesUpdate(chatMessages);

        const executionResult = await streamSingleAgent({
          endpoint,
          model: selectedModel,
          messages: executionMessages,
          signal,
          baselineFiles: currentFiles,
          messagePrefix: `**[${agentName} Agent]**\n\nExecuting: ${block.title}\n\n`,
          onPartialText: (_rawText, generatedFiles, cleanText) => {
            currentFiles = syncTaskFile(generatedFiles, executionBaselineFiles);
            onFilesUpdate(currentFiles);
            chatMessages[executionIndex] = {
              role: 'assistant',
              content: sanitizeAgentOutput(cleanText),
              filesGenerated: getChangedFiles(baselineFiles, generatedFiles),
            };
            onMessagesUpdate([...chatMessages]);
          },
        });

        currentFiles = syncTaskFile(executionResult.files, executionBaselineFiles);
        
        // Manually mark task as completed if it has no files, since syncTaskFile can't detect changes
        if (block.fileLines.length === 0 && currentFiles['task.md']) {
          const lines = currentFiles['task.md'].split('\n');
          if (lines[block.taskLineIndex] && lines[block.taskLineIndex].includes('- [ ]')) {
            lines[block.taskLineIndex] = lines[block.taskLineIndex].replace('- [ ]', '- [x]');
            currentFiles['task.md'] = lines.join('\n');
          }
        }
        
        onFilesUpdate(currentFiles);
        
        // Merge diagnostics
        finalDiagnostics.failedEditCount += executionResult.diagnostics.failedEditCount;
        finalDiagnostics.failedEditFiles.push(...executionResult.diagnostics.failedEditFiles);
        finalDiagnostics.overwrittenExistingFiles.push(...executionResult.diagnostics.overwrittenExistingFiles);
        finalDiagnostics.editResults.push(...executionResult.diagnostics.editResults);
      }
      
      return { files: currentFiles, diagnostics: finalDiagnostics };
    } else {
      onStatusUpdate({
        phase: 'building',
        agent: 'builder',
        searching: builderWorkflow === 'fix'
          ? 'Builder is applying targeted fixes to the current project...'
          : 'Builder is implementing the requested changes...',
      });

      const builderMessages = addSearchContext([
        { role: 'system' as const, content: getExecutionAgentPrompt(buildSpec, executionMode, builderWorkflow, plannerUsed) },
        ...chatMessages.filter((message) => message.role !== 'system'),
        {
          role: 'user' as const,
          content: userContextOverride || (builderWorkflow === 'fix'
              ? getFixUserContext(input, currentFiles)
              : getSingleAgentUserContext(input, currentFiles)),
        },
      ]);

      const baselineFiles = baselineFilesOverride ?? currentFiles;
      const builderIndex = chatMessages.length;
      chatMessages = [...chatMessages, { role: 'assistant', content: '' }];
      onMessagesUpdate(chatMessages);

      const builderResult = await streamSingleAgent({
        endpoint,
        model: selectedModel,
        messages: builderMessages,
        signal,
        baselineFiles: currentFiles,
        messagePrefix: executionMode === 'multi-agent' ? '**[Builder Agent]**\n\n' : '',
        onPartialText: (_rawText, generatedFiles, cleanText) => {
          currentFiles = generatedFiles;
          onFilesUpdate(currentFiles);
          chatMessages[builderIndex] = {
            role: 'assistant',
            content: sanitizeAgentOutput(cleanText),
            filesGenerated: getChangedFiles(baselineFiles, generatedFiles),
          };
          onMessagesUpdate([...chatMessages]);
        },
      });

      currentFiles = builderResult.files;
      onFilesUpdate(currentFiles);
      return builderResult;
    }
  };

  const runReviewerPass = async (revision: string): Promise<{ report: ReviewerReport; summary: string; revision: string }> => {
    onStatusUpdate({
      phase: executionMode === 'multi-agent' ? 'reviewing' : 'validating',
      agent: executionMode === 'multi-agent' ? 'reviewer' : null,
      searching: executionMode === 'multi-agent'
        ? 'Reviewer Agent is checking blockers, compliance, and quality risks...'
        : 'Inspecting the current project state...',
    });

    const reviewerMessages: OllamaMessage[] = [
      { role: 'system', content: getReviewerPrompt(buildSpec, plannerUsed) },
      { role: 'user', content: getReviewerUserContext(input, currentFiles, plannerUsed, revision) },
    ];

    const reviewerIndex = chatMessages.length;
    chatMessages = [...chatMessages, { role: 'assistant', content: '' }];
    onMessagesUpdate(chatMessages);

    let reviewerReport = createEmptyReviewerReport();
    let reviewerSummary = formatReviewerReport(reviewerReport);
    const reviewerResult = await streamSingleAgent({
      endpoint,
      model: selectedModel,
      messages: reviewerMessages,
      signal,
      baselineFiles: currentFiles,
      onPartialText: (_rawText, _generatedFiles, cleanText) => {
        const parsedReport = parseReviewerReport(cleanText);
        if (parsedReport) {
          reviewerReport = parsedReport;
          reviewerSummary = formatReviewerReport(reviewerReport);
        } else if (cleanText.trim()) {
          reviewerSummary = executionMode === 'multi-agent'
            ? `**[Reviewer Agent]**

${cleanText.trim()}`
            : cleanText.trim();
        }

        chatMessages[reviewerIndex] = { role: 'assistant', content: reviewerSummary };
        onMessagesUpdate([...chatMessages]);
      },
    });

    const parsedFinalReport = parseReviewerReport(reviewerResult.cleanText);
    if (parsedFinalReport) {
      reviewerReport = parsedFinalReport;
      reviewerSummary = formatReviewerReport(reviewerReport);
      chatMessages[reviewerIndex] = { role: 'assistant', content: reviewerSummary };
      onMessagesUpdate([...chatMessages]);
    }

    return { report: reviewerReport, summary: reviewerSummary, revision };
  };

  const runBoundReviewerValidation = async (
    diagnostics: ParserDiagnostics,
    phase: 'builder'
  ): Promise<{ report: ReviewerReport; summary: string; gateResults: GateResult[]; revision: string }> => {
    const revision = getFilesRevision(currentFiles);
    const { report, summary } = await runReviewerPass(revision);

    onStatusUpdate({
      phase: 'validating',
      agent: executionMode === 'multi-agent' ? 'reviewer' : null,
      searching: 'Running blocker, compliance, and quality gates...',
    });

    let gateResults = await runExecutionGates(currentFiles, buildSpec, executionMode, diagnostics, phase, plannerUsed);
    if (executionMode === 'multi-agent') {
      gateResults = dedupeGateResults([...gateResults, ...createReviewerDerivedGates(report)]);
    }

    return { report, summary, gateResults, revision };
  };

  const finalizeResult = async (gateResults: GateResult[], reviewerSummary: string, attemptCount: number) => {
    const summary = summarizeGateResults(buildSpec, gateResults, reviewerSummary, attemptCount, {
      executionMode,
      workflow,
      plannerUsed,
      planArtifactsCreated: plannerUsed,
    });

    onStatusUpdate({
      phase: gateResults.some((gate) => gate.status === 'fail') ? 'failed' : 'completed',
      agent: null,
      searching: false,
    });

    return { messages: chatMessages, files: currentFiles, gateResults, summary, buildSpec };
  };

  const runReviewAndFixLoop = async (initialDiagnostics: ParserDiagnostics) => {
    let {
      report: reviewerReport,
      summary: reviewerSummary,
      gateResults,
      revision: reviewedRevision,
    } = await runBoundReviewerValidation(initialDiagnostics, 'builder');
    let attemptCount = 0;

    if (executionMode !== 'multi-agent' || workflow === 'review' || workflow === 'inspect') {
      return finalizeResult(gateResults, reviewerSummary, attemptCount);
    }

    while (gateResults.some((gate) => gate.status === 'fail') && attemptCount < MAX_FIX_ATTEMPTS) {
      attemptCount += 1;
      
      onStatusUpdate({
        phase: 'routing',
        agent: 'lead',
        searching: `Lead Agent is determining the responsible agent for fixes (attempt ${attemptCount}/${MAX_FIX_ATTEMPTS})...`,
      });

      // Ask Lead Agent who should fix this
      let assignedBuilder = 'Builder';
      try {
        const leadResponse = await fetch(`${endpoint.replace(/\/$/, '')}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            prompt: `You are the Lead Agent. A reviewer found errors in the project. Based on the reviewer report, which agent should fix these errors? Choose exactly one from: Frontend, Backend, Database, Documentation, Builder.\n\nReviewer Report:\n${JSON.stringify(reviewerReport, null, 2)}\n\nOutput only the agent name.`,
            stream: false,
            options: { temperature: 0.1, num_predict: 20 },
          }),
          signal,
        });
        if (leadResponse.ok) {
          const data = await leadResponse.json();
          if (typeof data.response === 'string' && data.response.trim()) {
            const agent = data.response.trim().replace(/[^a-zA-Z]/g, '');
            if (['Frontend', 'Backend', 'Database', 'Documentation', 'Builder'].includes(agent)) {
              assignedBuilder = agent;
            }
          }
        }
      } catch (e) {
        // Fallback to Builder
      }

      onStatusUpdate({
        phase: 'fixing',
        agent: assignedBuilder.toLowerCase() as GenerationAgent,
        searching: `Lead Agent assigned fixes to ${assignedBuilder} Agent (attempt ${attemptCount}/${MAX_FIX_ATTEMPTS})...`,
      });

      const fixInstructions = getFailedGateSummary(gateResults);
      const failedGateFiles = getFailedGateAffectedFiles(gateResults);
      const nonPlanFailurePresent = hasNonPlanFailures(gateResults);
      const builderBaselineFiles = { ...currentFiles };
      const baselineRevision = reviewedRevision;

      const builderPromptContext = plannerUsed
        ? `Reviewed workspace revision: ${baselineRevision}

Approved plan artifacts:

${getPlanContext(currentFiles)}

`
        : `Reviewed workspace revision: ${baselineRevision}

`;

      const builderMessages: OllamaMessage[] = [
        { role: 'system', content: getExecutionAgentPrompt(buildSpec, executionMode, 'fix', plannerUsed, assignedBuilder) },
        {
          role: 'user',
          content: `${builderPromptContext}Original user request:
${input}

Reviewer report:
${JSON.stringify(reviewerReport, null, 2)}

Reviewer summary:
${reviewerSummary || 'No reviewer summary available.'}

Failed gates:
${fixInstructions}

Failing scope files: ${failedGateFiles.length > 0 ? failedGateFiles.join(', ') : 'none provided'}
Blocking failures present: ${hasBlockingFailures(gateResults) ? 'yes' : 'no'}
Non-plan failures still present: ${nonPlanFailurePresent ? 'yes' : 'no'}

Current files:
${JSON.stringify(currentFiles)}

Apply the smallest concrete repair set needed for the failing scope. If blocker or non-plan failures are present, do not spend this attempt only on task.md, structure.md, or plan.md.`,
        },
      ];

      const builderIndex = chatMessages.length;
      chatMessages = [...chatMessages, { role: 'assistant', content: '' }];
      onMessagesUpdate(chatMessages);

      const builderResult = await streamSingleAgent({
        endpoint,
        model: selectedModel,
        messages: builderMessages,
        signal,
        baselineFiles: currentFiles,
        messagePrefix: `**[${assignedBuilder} Agent]**\n\n`,
        onPartialText: (_rawText, generatedFiles, cleanText) => {
          currentFiles = plannerUsed ? syncTaskFile(generatedFiles, executionBaselineFiles) : generatedFiles;
          onFilesUpdate(currentFiles);
          chatMessages[builderIndex] = {
            role: 'assistant',
            content: sanitizeAgentOutput(cleanText),
            filesGenerated: getChangedFiles(builderBaselineFiles, currentFiles),
          };
          onMessagesUpdate([...chatMessages]);
        },
      });

      currentFiles = plannerUsed ? syncTaskFile(builderResult.files, executionBaselineFiles) : builderResult.files;
      onFilesUpdate(currentFiles);
      const builderChangedFiles = getChangedFiles(builderBaselineFiles, currentFiles);
      const nonPlanChangedFiles = getNonPlanChangedFiles(builderBaselineFiles, currentFiles);
      const currentRevision = getFilesRevision(currentFiles);

      if (builderChangedFiles.length === 0 && gateResults.some((gate) => gate.status === 'fail')) {
        gateResults = [...gateResults, createNoOpBuilderGate(attemptCount)];
        break;
      }

      onStatusUpdate({ phase: 'reviewing', agent: 'reviewer', searching: 'Reviewer Agent is validating the builder output...' });
      ({
        report: reviewerReport,
        summary: reviewerSummary,
        gateResults,
        revision: reviewedRevision,
      } = await runBoundReviewerValidation(builderResult.diagnostics, 'builder'));

      if (currentRevision !== reviewedRevision) {
        gateResults = dedupeGateResults([
          ...gateResults,
          {
            id: `review-stale-${attemptCount}`,
            status: 'fail',
            priority: 'blocker',
            scope: 'universal',
            title: 'Reviewer snapshot became stale during validation',
            message: `The reviewed revision (${reviewedRevision}) did not match the latest file revision (${currentRevision}). The loop will stop to avoid applying stale fixes.`,
            affectedFiles: [],
            autoFixHint: 'Re-run the review on the latest workspace snapshot before applying more edits.',
          },
        ]);
        break;
      }

      if (nonPlanChangedFiles.length === 0 && builderChangedFiles.length > 0 && (hasNonPlanFailures(gateResults) || hasBlockingFailures(gateResults))) {
        gateResults = [...gateResults, createPaperworkOnlyBuilderGate(attemptCount, builderChangedFiles)];
        break;
      }
    }

    return finalizeResult(gateResults, reviewerSummary, attemptCount);
  };

function getFilesToRedoFromInput(input: string): string[] {
  const normalized = input.toLowerCase();
  if (!/(redo|عيد|اعد|إعد|أعد|اعادة|إعادة|مرة ثانية|مرة اخري)/i.test(normalized)) return [];
  
  // Extract file extensions or names if mentioned
  const files: string[] = [];
  const matches = input.match(/[a-zA-Z0-9_\-\.\/]+\.(tsx|ts|css|html|js|json)/gi);
  if (matches) files.push(...matches);
  
  return files;
}

function resetTasksForFiles(files: Record<string, string>, redoFiles: string[]): Record<string, string> {
  const taskContent = files['task.md'];
  if (!taskContent || redoFiles.length === 0) return files;
  
  let newContent = taskContent;
  const lines = taskContent.split('\n');
  
  // For each file to redo, find the line in task.md and uncheck it
  // and also uncheck its parent task
  for (const file of redoFiles) {
    const fileBasename = file.split('/').pop() || file;
    let foundLineIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
       if (lines[i].includes(`\`${file}\``) || lines[i].includes(`\`${fileBasename}\``)) {
         if (lines[i].includes('- [x]')) {
           lines[i] = lines[i].replace('- [x]', '- [ ]');
           foundLineIndex = i;
         }
       }
    }
    
    if (foundLineIndex !== -1) {
      // Find the parent task (the nearest previous line starting with - [x] Task title)
      for (let j = foundLineIndex - 1; j >= 0; j--) {
        if (lines[j].trim().startsWith('- [x]') && !lines[j].includes('`')) {
          lines[j] = lines[j].replace('- [x]', '- [ ]');
          break;
        }
      }
    }
  }
  
  return { ...files, 'task.md': lines.join('\n') };
}

  if (workflow === 'chat') {
    await runExecutionPass('chat');
    return finalizeResult([], '', 0);
  }

  if (workflow === 'resume') {
    const redoFiles = getFilesToRedoFromInput(input);
    if (redoFiles.length > 0) {
      currentFiles = resetTasksForFiles(currentFiles, redoFiles);
      onFilesUpdate(currentFiles);
    }
    
    const builderResult = await runExecutionPass('build', currentFiles);
    if (executionMode === 'single-agent') {
      const gateResults = await runExecutionGates(currentFiles, buildSpec, executionMode, builderResult.diagnostics, 'builder', plannerUsed);
      return finalizeResult(gateResults, '', 0);
    }
    return runReviewAndFixLoop(builderResult.diagnostics);
  }

  if (workflow === 'build' || workflow === 'rebuild') {
    const builderResult = await runExecutionPass(workflow, currentFiles);

    if (executionMode === 'single-agent') {
      onStatusUpdate({ phase: 'validating', agent: null, searching: 'Running quality gates...' });
      const gateResults = await runExecutionGates(currentFiles, buildSpec, executionMode, builderResult.diagnostics, 'builder', plannerUsed);
      return finalizeResult(gateResults, '', 0);
    }

    return runReviewAndFixLoop(builderResult.diagnostics);
  }

  if (workflow === 'fix' && executionMode === 'single-agent') {
    const builderResult = await runExecutionPass('fix', currentFiles);
    onStatusUpdate({ phase: 'validating', agent: null, searching: 'Running quality gates...' });
    let gateResults = await runExecutionGates(currentFiles, buildSpec, executionMode, builderResult.diagnostics, 'builder', plannerUsed);

    if (gateResults.some((gate) => gate.status === 'fail')) {
      const retryContext = `Original user request:
${input}

Failed gates:
${getFailedGateSummary(gateResults)}

Current files:
${JSON.stringify(currentFiles)}

Repair only the listed failures with targeted <file> or <edit> changes.`;
      const retryResult = await runExecutionPass('fix', currentFiles, retryContext);
      onStatusUpdate({ phase: 'validating', agent: null, searching: 'Re-running quality gates after fix retry...' });
      gateResults = await runExecutionGates(currentFiles, buildSpec, executionMode, retryResult.diagnostics, 'builder', plannerUsed);
    }

    return finalizeResult(gateResults, '', gateResults.some((gate) => gate.status === 'fail') ? 1 : 0);
  }

  return runReviewAndFixLoop(emptyDiagnostics);
}
