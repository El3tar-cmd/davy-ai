export type { OllamaMessage } from '../lib/ollama';
import type React from 'react';

export interface Attachment {
  url: string;
  base64: string;
  name?: string;
  type?: string;
  size?: number;
  isText?: boolean;
  textContent?: string;
}

export interface ProjectHistoryState {
  messages: import('../lib/ollama').OllamaMessage[];
  files: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  messages: import('../lib/ollama').OllamaMessage[];
  files: Record<string, string>;
  history: ProjectHistoryState[];
  historyIndex: number;
  updatedAt: number;
}

export type DeviceSize = 'desktop' | 'tablet' | 'mobile';
export type ActiveTab = 'preview' | 'code' | 'console';
export type BootPhase = 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'error';
export type DatabaseProvider = 'supabase' | 'firebase';

export type AppKind = 'frontend' | 'backend' | 'full-stack';
export type ExecutionMode = 'single-agent' | 'multi-agent';
export type WorkflowKind = 'build' | 'review' | 'fix' | 'inspect' | 'rebuild';
export type GenerationPhase = 'idle' | 'routing' | 'planning' | 'building' | 'reviewing' | 'validating' | 'fixing' | 'completed' | 'failed';
export type GenerationAgent = 'lead' | 'planner' | 'builder' | 'reviewer' | 'fixer' | 'frontend' | 'backend' | 'database' | 'documentation' | null;
export type GateStatus = 'pass' | 'warn' | 'fail';
export type GatePriority = 'blocker' | 'compliance' | 'quality';
export type ManifestRole = 'frontend' | 'backend' | 'unknown';
export type WorkspaceMode = 'single' | 'paired';
export type DevTargetStatus = 'idle' | 'installing' | 'starting' | 'running' | 'failed';
export type ProjectIntent = 'create' | 'modify';
export type TargetSurface = 'frontend' | 'backend' | 'full-stack' | 'mixed';
export type RepairStrategy = 'minimal-edit' | 'scoped-rewrite';

export interface PlanArtifactSet {
  implementation: string;
  structure: string;
  task: string;
}

export interface BuildSpec {
  appKind: AppKind;
  featureSet: string[];
  uiStyle: string;
  dataRequirements: string[];
  requiredFiles: string[];
  acceptanceChecks: string[];
  plannerNotes: string;
  planArtifacts: PlanArtifactSet;
  projectIntent: ProjectIntent;
  targetSurface: TargetSurface;
  repairStrategy: RepairStrategy;
}

export interface GateResult {
  id: string;
  status: GateStatus;
  priority: GatePriority;
  scope: AppKind | 'universal';
  title: string;
  message: string;
  affectedFiles: string[];
  autoFixHint?: string;
}

export interface RoutingDecision {
  workflow: WorkflowKind;
  needsPlanner: boolean;
  targetAgent: GenerationAgent;
  shouldPreserveFiles: boolean;
  reason: string;
}

export interface ReviewerFinding {
  title: string;
  message: string;
  affectedFiles: string[];
}

export interface ReviewerReport {
  runtimeBlockers: ReviewerFinding[];
  buildBlockers: ReviewerFinding[];
  complianceFailures: ReviewerFinding[];
  qualityWarnings: ReviewerFinding[];
  verdict: string;
}

export interface GenerationSummary {
  appKind: AppKind;
  executionMode: ExecutionMode;
  workflow: WorkflowKind;
  plannerUsed: boolean;
  attemptCount: number;
  passed: number;
  warnings: number;
  failed: number;
  blockerFailures: number;
  complianceFailures: number;
  qualityWarnings: number;
  reviewerSummary: string;
  planArtifactsCreated: boolean;
  planCompliancePassed: boolean;
  runtimeValidated: boolean;
  runtimeFailures: number;
  previewBootPassed: boolean;
  requestResolved: boolean;
  projectClean: boolean;
}

export interface RuntimeValidationResult {
  status: 'pass' | 'fail' | 'timeout';
  errors: string[];
  bootPhase: BootPhase;
  previewUrlPresent: boolean;
  domSnapshot?: string;
}

export interface DevTarget {
  manifestPath: string;
  label: string;
  dir: string;
  role: ManifestRole;
  status: DevTargetStatus;
  url?: string;
  message?: string;
  isPreviewTarget?: boolean;
}

export interface ClickToEditMessage {
  type: 'CLICK_TO_EDIT';
  tagName: string;
  className?: string;
  text?: string;
  id?: string;
}

export interface RuntimeErrorMessage {
  type: 'RUNTIME_ERROR';
  payload: string;
}

export interface DomSnapshotMessage {
  type: 'DOM_SNAPSHOT';
  payload: string;
}

export interface RequestDomSnapshotMessage {
  type: 'REQUEST_DOM_SNAPSHOT';
}

export type PreviewBridgeMessage =
  | ClickToEditMessage
  | RuntimeErrorMessage
  | DomSnapshotMessage
  | RequestDomSnapshotMessage;

export type PreviewFrameRef = React.RefObject<HTMLIFrameElement | null>;
