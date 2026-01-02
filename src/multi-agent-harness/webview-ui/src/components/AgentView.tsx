import { useState, useEffect, useCallback } from 'react';
import { ActivityStream, ActivityEntry } from './ActivityStream';
import { EditPreview, FileEdit } from './EditPreview';
import { AgentCard } from './AgentCard';
import type { ChatMessage, AgentState } from '../App';

interface FileClaim {
  pathPattern: string;
  agentName: string;
  claimType: 'exclusive' | 'shared';
  timestamp: Date;
}

interface OrchestratorState {
  status: 'idle' | 'processing' | 'error';
  messages: ChatMessage[];
  agents: AgentState[];
  claims: FileClaim[];
}

interface AgentViewProps {
  agentName: string;
  isOrchestrator: boolean;
}

export function AgentView({ agentName, isOrchestrator }: AgentViewProps) {
  const [orchestratorState, setOrchestratorState] = useState<OrchestratorState | null>(null);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [fileEdits, setFileEdits] = useState<FileEdit[]>([]);
  const [selectedTab, setSelectedTab] = useState<'activity' | 'edits' | 'claims'>('activity');

  useEffect(() => {
    // Request initial state
    window.vscode?.postMessage({ type: 'refresh' });

    const handler = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'orchestratorState':
          setOrchestratorState(message.data);
          break;

        case 'agentState':
          setAgentState(message.data);
          break;

        case 'agentOutput':
          // Add to activity stream
          const outputEntry: ActivityEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            agentName: message.agentName,
            type: message.output.type,
            content: formatOutput(message.output),
          };
          setActivities(prev => [...prev, outputEntry].slice(-200));

          // Track file edits
          if (message.output.type === 'toolResult' && message.output.toolName?.includes('edit')) {
            const edit: FileEdit = {
              id: crypto.randomUUID(),
              agentName: message.agentName,
              filePath: message.output.filePath || 'unknown',
              diff: message.output.diff || '',
              timestamp: new Date(),
              status: message.output.success ? 'applied' : 'failed',
            };
            setFileEdits(prev => [...prev, edit].slice(-50));
          }
          break;

        case 'agentStatusChanged':
          if (isOrchestrator) {
            setOrchestratorState(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                agents: prev.agents.map(a =>
                  a.name === message.agentName
                    ? { ...a, status: message.status }
                    : a
                ),
              };
            });
          } else if (message.agentName === agentName) {
            setAgentState(prev => prev ? { ...prev, status: message.status } : prev);
          }
          break;

        case 'claimsUpdated':
          if (isOrchestrator) {
            setOrchestratorState(prev => {
              if (!prev) return prev;
              return { ...prev, claims: message.claims };
            });
          }
          break;

        case 'orchestratorMessage':
          if (isOrchestrator) {
            const msgEntry: ActivityEntry = {
              id: crypto.randomUUID(),
              timestamp: new Date(),
              agentName: 'orchestrator',
              type: 'message',
              content: message.message.content,
            };
            setActivities(prev => [...prev, msgEntry].slice(-200));
          }
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [agentName, isOrchestrator]);

  const handlePauseAgent = useCallback((name: string) => {
    window.vscode?.postMessage({ type: 'pauseAgent', agentName: name });
  }, []);

  const handleResumeAgent = useCallback((name: string) => {
    window.vscode?.postMessage({ type: 'resumeAgent', agentName: name });
  }, []);

  const handleStopAgent = useCallback((name: string) => {
    window.vscode?.postMessage({ type: 'stopAgent', agentName: name });
  }, []);

  const handleOpenFile = useCallback((filePath: string) => {
    window.vscode?.postMessage({ type: 'openFile', filePath });
  }, []);

  const handleOpenDiff = useCallback((edit: FileEdit) => {
    window.vscode?.postMessage({
      type: 'openDiff',
      filePath: edit.filePath,
      diff: edit.diff,
      oldContent: edit.oldContent,
      newContent: edit.newContent,
    });
  }, []);

  const handleSendMessage = useCallback((name: string, text: string) => {
    window.vscode?.postMessage({ type: 'sendMessage', agentName: name, text });
  }, []);

  if (isOrchestrator) {
    return (
      <div className="agent-view orchestrator-view">
        <header className="agent-view-header">
          <h1>Multi-Agent Monitor</h1>
          <div className="status-badge" data-status={orchestratorState?.status || 'idle'}>
            {orchestratorState?.status || 'idle'}
          </div>
        </header>

        <div className="view-tabs">
          <button
            className={selectedTab === 'activity' ? 'active' : ''}
            onClick={() => setSelectedTab('activity')}
          >
            Activity Stream
          </button>
          <button
            className={selectedTab === 'edits' ? 'active' : ''}
            onClick={() => setSelectedTab('edits')}
          >
            File Edits ({fileEdits.length})
          </button>
          <button
            className={selectedTab === 'claims' ? 'active' : ''}
            onClick={() => setSelectedTab('claims')}
          >
            File Claims ({orchestratorState?.claims?.length || 0})
          </button>
        </div>

        <div className="view-content">
          <aside className="agents-sidebar">
            <h3>Active Agents</h3>
            {orchestratorState?.agents?.map(agent => (
              <AgentCard
                key={agent.name}
                agent={agent}
                onPause={() => handlePauseAgent(agent.name)}
                onResume={() => handleResumeAgent(agent.name)}
                onStop={() => handleStopAgent(agent.name)}
                onSendMessage={(text) => handleSendMessage(agent.name, text)}
              />
            ))}
            {(!orchestratorState?.agents || orchestratorState.agents.length === 0) && (
              <div className="no-agents">No agents running</div>
            )}
          </aside>

          <main className="main-panel">
            {selectedTab === 'activity' && (
              <ActivityStream
                entries={activities}
                onOpenFile={handleOpenFile}
              />
            )}
            {selectedTab === 'edits' && (
              <div className="edits-list">
                {fileEdits.map(edit => (
                  <EditPreview
                    key={edit.id}
                    edit={edit}
                    onOpenFile={handleOpenFile}
                    onOpenDiff={handleOpenDiff}
                  />
                ))}
                {fileEdits.length === 0 && (
                  <div className="no-edits">No file edits yet</div>
                )}
              </div>
            )}
            {selectedTab === 'claims' && (
              <div className="claims-list">
                {orchestratorState?.claims?.map(claim => (
                  <div
                    key={`${claim.agentName}-${claim.pathPattern}`}
                    className={`claim-item ${claim.claimType}`}
                    onClick={() => handleOpenFile(claim.pathPattern)}
                  >
                    <span className="claim-path">{claim.pathPattern}</span>
                    <span className="claim-agent">{claim.agentName}</span>
                    <span className="claim-type">{claim.claimType}</span>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    );
  }

  // Single agent view
  return (
    <div className="agent-view single-agent-view">
      <header className="agent-view-header">
        <h1>{agentName}</h1>
        {agentState && (
          <>
            <span className="agent-role">{agentState.role}</span>
            <div className="status-badge" data-status={agentState.status}>
              {agentState.status}
            </div>
          </>
        )}
      </header>

      {agentState && (
        <div className="agent-controls">
          <button
            onClick={() => handlePauseAgent(agentName)}
            disabled={agentState.status === 'paused'}
          >
            Pause
          </button>
          <button
            onClick={() => handleResumeAgent(agentName)}
            disabled={agentState.status !== 'paused'}
          >
            Resume
          </button>
          <button
            className="danger"
            onClick={() => handleStopAgent(agentName)}
          >
            Stop
          </button>
        </div>
      )}

      <div className="agent-focus">
        <strong>Focus:</strong> {agentState?.focus || 'Loading...'}
      </div>

      <div className="view-tabs">
        <button
          className={selectedTab === 'activity' ? 'active' : ''}
          onClick={() => setSelectedTab('activity')}
        >
          Activity
        </button>
        <button
          className={selectedTab === 'edits' ? 'active' : ''}
          onClick={() => setSelectedTab('edits')}
        >
          Edits ({fileEdits.length})
        </button>
      </div>

      <div className="view-content single-agent-content">
        {selectedTab === 'activity' && (
          <ActivityStream
            entries={activities.filter(a => a.agentName === agentName)}
            onOpenFile={handleOpenFile}
          />
        )}
        {selectedTab === 'edits' && (
          <div className="edits-list">
            {fileEdits
              .filter(e => e.agentName === agentName)
              .map(edit => (
                <EditPreview
                  key={edit.id}
                  edit={edit}
                  onOpenFile={handleOpenFile}
                  onOpenDiff={handleOpenDiff}
                />
              ))}
            {fileEdits.filter(e => e.agentName === agentName).length === 0 && (
              <div className="no-edits">No file edits yet</div>
            )}
          </div>
        )}
      </div>

      <div className="agent-input-area">
        <input
          type="text"
          placeholder="Send a message to this agent..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              handleSendMessage(agentName, e.currentTarget.value.trim());
              e.currentTarget.value = '';
            }
          }}
        />
      </div>
    </div>
  );
}

function formatOutput(output: any): string {
  switch (output.type) {
    case 'text':
      return output.text || '';
    case 'toolCall':
      return `Tool: ${output.toolName}(${JSON.stringify(output.arguments || {}).slice(0, 100)}...)`;
    case 'toolResult':
      return output.result ? String(output.result).slice(0, 200) : 'No result';
    default:
      return JSON.stringify(output).slice(0, 200);
  }
}
