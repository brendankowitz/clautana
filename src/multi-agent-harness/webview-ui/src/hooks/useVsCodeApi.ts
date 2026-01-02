import { useMemo } from 'react';
import type { VsCodeApi } from '../globals.d.ts';
// Global types from globals.d.ts

let vscodeApiInstance: VsCodeApi | null = null;

function getVsCodeApi(): VsCodeApi {
  if (vscodeApiInstance) {
    return vscodeApiInstance;
  }

  // First check if vscode API was already acquired and stored on window
  if (window.vscode) {
    vscodeApiInstance = window.vscode;
    return vscodeApiInstance;
  }

  // Try to acquire the API (can only be called once per session)
  if (typeof window.acquireVsCodeApi === 'function') {
    try {
      vscodeApiInstance = window.acquireVsCodeApi();
      return vscodeApiInstance;
    } catch (e) {
      console.warn('Failed to acquire VS Code API:', e);
    }
  }

  // Mock for development outside VS Code
  console.warn('VS Code API not available, using mock');
  return {
    postMessage: (message: unknown) => {
      console.log('[VS Code Mock] postMessage:', message);
    },
    getState: () => {
      return null;
    },
    setState: (state: unknown) => {
      console.log('[VS Code Mock] setState:', state);
    },
  };
}

export function useVsCodeApi(): VsCodeApi {
  return useMemo(() => getVsCodeApi(), []);
}
