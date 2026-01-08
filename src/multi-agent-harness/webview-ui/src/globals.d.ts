/**
 * Shared global type definitions for webview
 */

export interface VsCodeApi {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

declare global {
  interface Window {
    /** VS Code API - may be undefined if called before acquireVsCodeApi or in dev mode */
    acquireVsCodeApi?: () => VsCodeApi;
    /** VS Code API instance - set by inline script in webview HTML */
    vscode?: VsCodeApi;
    /** Agent name - set by AgentEditorProvider */
    agentName?: string;
    /** Whether viewing orchestrator - set by AgentEditorProvider */
    isOrchestrator?: boolean;
  }
}
