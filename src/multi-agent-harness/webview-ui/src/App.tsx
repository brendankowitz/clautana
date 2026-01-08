import { useState, useEffect, useCallback, useRef } from 'react';
import { AgentBar } from './components/AgentBar';
import { ChatPanel } from './components/ChatPanel';
import { ChatInput } from './components/ChatInput';
import { AgentDetailModal } from './components/AgentDetailModal';
import { useVsCodeApi } from './hooks/useVsCodeApi';
import './styles/index.css';

export interface OrchestratorMessage {
  id: string;
  role: 'user' | 'assistant' | 'orchestrator';
  content: string;
  timestamp: Date;
  reportType?: 'progress' | 'complete' | 'error' | 'question';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
  };
}

interface OrchestratorState {
  status: 'idle' | 'processing' | 'error';
  currentTask?: string;
  messages: OrchestratorMessage[];
  contextUsage?: number;
}

export interface AgentState {
  name: string;
  role: string;
  focus: string;
  status: 'waiting' | 'idle' | 'processing' | 'complete' | 'error' | 'paused' | 'initializing';
  color: string;
  messages: ChatMessage[];
  waitingFor: string[];
  fileClaims?: string[];
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body?: string;
  timestamp: Date;
  read: boolean;
}

export function App() {
  const vscode = useVsCodeApi();
  const [orchestrator, setOrchestrator] = useState<OrchestratorState>({
    status: 'idle',
    messages: [],
  });
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [showAgentDetail, setShowAgentDetail] = useState(false);
  const [commandQueue, setCommandQueue] = useState<string[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingWorkItems, setPendingWorkItems] = useState(0);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    console.log('[App] Requesting initial state');
    vscode.postMessage({ type: 'getState' });

    const handler = (event: MessageEvent) => {
      const message = event.data;
      console.log('[App] Received message:', message.type, message);

      switch (message.type) {
        case 'state':
          setOrchestrator(message.orchestrator);
          setAgents(message.agents);
          setUnreadMessages(message.unreadMessages || 0);
          setPendingWorkItems(message.pendingWorkItems || 0);
          break;

        case 'orchestratorUpdate':
          setOrchestrator((prev) => ({ ...prev, ...message.updates }));
          break;

        case 'orchestratorMessage':
          setOrchestrator((prev) => ({
            ...prev,
            messages: [...prev.messages, message.message],
          }));
          break;

        case 'agentSpawned':
          setAgents((prev) => [...prev, message.agent]);
          break;

        case 'agentDestroyed':
          setAgents((prev) => prev.filter((a) => a.name !== message.agentName));
          if (selectedAgentName === message.agentName) {
            setSelectedAgentName(null);
            setShowAgentDetail(false);
          }
          break;

        case 'agentUpdate':
          setAgents((prev) =>
            prev.map((a) =>
              a.name === message.agentName ? { ...a, ...message.updates } : a
            )
          );
          break;

        case 'agentMessage':
          setAgents((prev) =>
            prev.map((a) =>
              a.name === message.agentName
                ? { ...a, messages: [...a.messages, message.message] }
                : a
            )
          );
          break;

        case 'claimsUpdated':
          // Update file claims for agents based on the claims data
          setAgents((prev) =>
            prev.map((a) => ({
              ...a,
              fileClaims: message.claims
                .filter((c: { agentName: string }) => c.agentName === a.name)
                .map((c: { pathPattern: string }) => c.pathPattern),
            }))
          );
          break;

        case 'interAgentMessage':
          // Add a visual representation to the orchestrator chat
          const agentMsgContent = `📧 **Agent Message: ${message.message.subject}**\n` +
            `From: ${message.message.from} → To: ${message.message.to}\n` +
            (message.message.body ? `\n${message.message.body}` : '');

          setOrchestrator((prev) => ({
            ...prev,
            messages: [...prev.messages, {
              id: message.message.id,
              role: 'orchestrator' as const,
              content: agentMsgContent,
              timestamp: message.message.timestamp,
            }],
          }));
          break;

        case 'error':
          console.error('Extension error:', message.error);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [vscode, selectedAgentName]);

  const submitTask = useCallback((task: string) => {
    // If currently processing, queue the command
    if (isProcessingRef.current) {
      setCommandQueue(prev => [...prev, task]);
      console.log('[App] Queued command:', task);
    } else {
      vscode.postMessage({ type: 'submitTask', task });
    }
  }, [vscode]);

  // Process queue when orchestrator becomes idle
  useEffect(() => {
    isProcessingRef.current = orchestrator.status === 'processing';

    if (orchestrator.status === 'idle' && commandQueue.length > 0) {
      const [nextCommand, ...remaining] = commandQueue;
      setCommandQueue(remaining);
      console.log('[App] Processing queued command:', nextCommand);
      vscode.postMessage({ type: 'submitTask', task: nextCommand });
    }
  }, [orchestrator.status, commandQueue, vscode]);

  const stopAll = useCallback(() => {
    vscode.postMessage({ type: 'stopAll' });
  }, [vscode]);

  const handleSelectAgent = useCallback((agentName: string) => {
    setSelectedAgentName(agentName);
    setShowAgentDetail(true);
  }, []);

  const handleCloseAgentDetail = useCallback(() => {
    setShowAgentDetail(false);
    setSelectedAgentName(null);
  }, []);

  const handleAgentAction = useCallback((agentName: string, action: 'pause' | 'resume' | 'stop') => {
    switch (action) {
      case 'pause':
        vscode.postMessage({ type: 'pauseAgent', agentName });
        break;
      case 'resume':
        vscode.postMessage({ type: 'resumeAgent', agentName });
        break;
      case 'stop':
        vscode.postMessage({ type: 'destroyAgent', agentName });
        break;
    }
  }, [vscode]);

  const selectedAgent = agents.find((a) => a.name === selectedAgentName) ?? null;

  // Convert orchestrator messages to ChatMessage format for the ChatPanel
  const orchestratorChatMessages: ChatMessage[] = orchestrator.messages.map((msg) => ({
    id: msg.id,
    role: msg.role === 'orchestrator' ? 'assistant' : msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  }));

  return (
    <div className="app-container-fullwidth">
      <main className="main-content-fullwidth">
        <ChatPanel
          messages={orchestratorChatMessages}
          isProcessing={orchestrator.status === 'processing'}
          currentTask={orchestrator.currentTask}
          onStop={stopAll}
          unreadMessages={unreadMessages}
          pendingWorkItems={pendingWorkItems}
          contextUsage={orchestrator.contextUsage}
          onSubmitTask={submitTask}
        />

        <ChatInput
          onSubmit={submitTask}
          isProcessing={orchestrator.status === 'processing'}
          queueLength={commandQueue.length}
          placeholder="Describe a task for the orchestrator..."
        />

        <AgentBar
          orchestratorStatus={orchestrator.status}
          agents={agents}
          onSelectAgent={handleSelectAgent}
        />
      </main>

      {showAgentDetail && selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={handleCloseAgentDetail}
          onAction={handleAgentAction}
        />
      )}
    </div>
  );
}
