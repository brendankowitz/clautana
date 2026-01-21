/**
 * Copilot SDK session implementation
 * 
 * Wraps @github/copilot-sdk CopilotSession to provide the BackendSession interface.
 * Converts Copilot's event-based model to AsyncIterable<AgentMessage>.
 * 
 * Reference: https://github.com/github/copilot-sdk
 */

import * as crypto from 'crypto';
import { BackendSession, AgentMessage, SendOptions, BackendType } from '../types';

/**
 * Event types from Copilot SDK
 */
interface CopilotEvent {
  type: string;
  data?: {
    content?: string;
    deltaContent?: string;
    tool?: { name: string; id: string };
    arguments?: Record<string, unknown>;
    result?: unknown;
  };
}

/**
 * Interface for the underlying Copilot SDK session
 */
interface CopilotSdkSession {
  on(handler: (event: CopilotEvent) => void): () => void;
  send(options: { prompt: string }): Promise<string>;
  sendAndWait(options: { prompt: string }, timeout?: number): Promise<unknown>;
  abort(): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * Copilot SDK session implementation
 * 
 * Converts Copilot's event-based streaming to AsyncIterable<AgentMessage>:
 * - assistant.message -> type: 'text'
 * - assistant.message_delta -> type: 'text' (streaming)
 * - tool.execution_start -> type: 'toolCall'
 * - tool.execution_end -> type: 'toolResult'
 * - session.idle -> type: 'complete'
 * - error -> type: 'error'
 */
export class CopilotSession implements BackendSession {
  readonly backendType: BackendType = 'copilot';
  
  private _sdkSession?: CopilotSdkSession;
  private _unsubscribe?: () => void;
  private _abortController?: AbortController;

  constructor(
    public readonly id: string,
    private readonly _options: {
      sdkSession?: CopilotSdkSession;
      model?: string;
    }
  ) {
    console.log(`[Copilot Backend] Session created: ${id}`);
    this._sdkSession = _options.sdkSession;
  }

  /**
   * Set the underlying SDK session (called by CopilotBackend after creation)
   */
  setSdkSession(session: CopilotSdkSession): void {
    this._sdkSession = session;
    console.log(`[Copilot Backend] SDK session attached to ${this.id}`);
  }

  /**
   * Send a prompt and receive streaming responses
   * 
   * Converts Copilot's event-based model to AsyncIterable:
   * 1. Sets up event listeners on the SDK session
   * 2. Sends the prompt via session.send()
   * 3. Yields AgentMessages as events arrive
   * 4. Completes when session.idle event is received
   */
  async *send(prompt: string, options?: SendOptions): AsyncIterable<AgentMessage> {
    if (!this._sdkSession) {
      const error = new Error('[Copilot Backend] No SDK session available');
      console.error(error.message);
      yield { type: 'error', error, _backend: 'copilot' };
      return;
    }

    console.log(`[Copilot Backend] Sending prompt to session ${this.id}`);

    // Create abort controller
    this._abortController = options?.abortController || new AbortController();

    // Queue for converting events to async iterator
    const messageQueue: AgentMessage[] = [];
    let resolveWaiting: (() => void) | null = null;
    let isComplete = false;
    let hasError = false;

    // Helper to push message and wake up consumer
    const pushMessage = (msg: AgentMessage) => {
      msg._backend = 'copilot';
      messageQueue.push(msg);
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    // Set up event listeners
    this._unsubscribe = this._sdkSession.on((event: CopilotEvent) => {
      console.log(`[Copilot Backend] Event: ${event.type}`);
      
      switch (event.type) {
        case 'assistant.message':
          // Final complete message
          if (event.data?.content) {
            pushMessage({
              type: 'text',
              content: event.data.content,
            });
          }
          break;
          
        case 'assistant.message_delta':
          // Streaming chunk
          if (event.data?.deltaContent) {
            pushMessage({
              type: 'text',
              content: event.data.deltaContent,
            });
          }
          break;
          
        case 'tool.execution_start':
          // Tool call initiated
          if (event.data?.tool) {
            pushMessage({
              type: 'toolCall',
              toolCall: {
                id: event.data.tool.id || crypto.randomUUID(),
                name: event.data.tool.name,
                arguments: event.data.arguments || {},
              },
            });
          }
          break;
          
        case 'tool.execution_end':
          // Tool call completed
          pushMessage({
            type: 'toolResult',
            result: event.data?.result,
          });
          break;
          
        case 'session.idle':
          // Conversation turn complete
          pushMessage({
            type: 'complete',
            sessionId: this.id,
          });
          isComplete = true;
          break;
          
        case 'error':
          hasError = true;
          pushMessage({
            type: 'error',
            error: new Error(event.data?.content || 'Unknown Copilot error'),
          });
          isComplete = true;
          break;
      }
    });

    // Send the prompt (non-blocking)
    try {
      await this._sdkSession.send({ prompt });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Copilot Backend] Error sending prompt:`, error.message);
      pushMessage({ type: 'error', error });
      isComplete = true;
    }

    // Yield messages as they arrive
    while (!isComplete || messageQueue.length > 0) {
      // Check for abort
      if (this._abortController?.signal.aborted) {
        console.log(`[Copilot Backend] Session ${this.id} aborted`);
        yield { type: 'error', error: new Error('Aborted'), _backend: 'copilot' };
        break;
      }

      // If queue is empty, wait for next message
      if (messageQueue.length === 0 && !isComplete) {
        await new Promise<void>(resolve => {
          resolveWaiting = resolve;
          // Timeout to prevent infinite wait
          setTimeout(() => {
            if (resolveWaiting === resolve) {
              resolveWaiting = null;
              resolve();
            }
          }, 100);
        });
        continue;
      }

      // Yield queued messages
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift()!;
        yield msg;
        
        // Stop on error
        if (msg.type === 'error') {
          hasError = true;
          break;
        }
      }

      if (hasError) break;
    }

    // Cleanup
    this._cleanup();
    console.log(`[Copilot Backend] Session ${this.id} send complete`);
  }

  /**
   * Abort the current operation
   */
  async abort(): Promise<void> {
    console.log(`[Copilot Backend] Aborting session ${this.id}`);
    
    this._abortController?.abort();
    
    if (this._sdkSession) {
      try {
        await this._sdkSession.abort();
      } catch (err) {
        console.error(`[Copilot Backend] Error aborting session:`, err);
      }
    }
    
    this._cleanup();
  }

  /**
   * Destroy the session and cleanup resources
   */
  async destroy(): Promise<void> {
    console.log(`[Copilot Backend] Destroying session ${this.id}`);
    
    this._cleanup();
    
    if (this._sdkSession) {
      try {
        await this._sdkSession.destroy();
      } catch (err) {
        console.error(`[Copilot Backend] Error destroying session:`, err);
      }
      this._sdkSession = undefined;
    }
  }

  /**
   * Internal cleanup helper
   */
  private _cleanup(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = undefined;
    }
    this._abortController = undefined;
  }
}
