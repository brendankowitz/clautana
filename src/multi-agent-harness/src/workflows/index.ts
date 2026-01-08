/**
 * Workflows Module
 *
 * Provides workflow handlers for different development methodologies:
 * - ADR Workflow: Investigation-driven with formal decision tracking
 * - Spec-Kit Workflow: Spec-driven with GitHub templates
 */

// ADR Workflow Handlers
export {
  // Types
  type AdrHandlerContext,
  type AdrHandlerResult,
  // Handler functions
  handleFnFeature,
  handleFnInvestigation,
  handleFnAdr,
  handleFnReject,
  handleFnTask,
  handleFnAccept,
  handleFnReview,
  handleFnDocument,
  // Registry and executor
  adrWorkflowHandlers,
  executeAdrCommand,
} from './AdrWorkflowHandlers';

// Spec-Kit Workflow Handlers
export {
  // Types
  type SpecKitHandlerContext,
  type SpecKitHandlerResult,
  // Handler functions
  handleSpecKitInit,
  handleSpecKitConstitution,
  handleSpecKitSpecify,
  handleSpecKitPlan,
  handleSpecKitTasks,
  handleSpecKitImplement,
  handleSpecKitClarify,
  handleSpecKitAnalyze,
  // Registry and executor
  specKitHandlers,
  executeSpecKitCommand,
  getSpecKitCommands,
} from './SpecKitWorkflowHandlers';
