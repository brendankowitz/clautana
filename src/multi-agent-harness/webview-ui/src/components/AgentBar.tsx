import { useState } from 'react';
import type { AgentState } from '../App';

interface AgentBarProps {
  orchestratorStatus: 'idle' | 'processing' | 'error';
  agents: AgentState[];
  onSelectAgent: (agentName: string) => void;
}

const statusColors: Record<string, string> = {
  idle: 'var(--vscode-charts-gray, #6b7280)',
  processing: 'var(--vscode-charts-blue, #3b82f6)',
  error: 'var(--vscode-errorForeground, #ef4444)',
  waiting: 'var(--vscode-charts-yellow, #f59e0b)',
  complete: 'var(--vscode-charts-green, #22c55e)',
  paused: 'var(--vscode-charts-orange, #f97316)',
  initializing: 'var(--vscode-charts-purple, #a855f7)',
};

const statusLabels: Record<string, string> = {
  idle: 'Idle',
  processing: 'Working',
  error: 'Error',
  waiting: 'Waiting',
  complete: 'Complete',
  paused: 'Paused',
  initializing: 'Starting',
};

export function AgentBar({
  orchestratorStatus,
  agents,
  onSelectAgent,
}: AgentBarProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Hide completely when idle with no agents
  if (agents.length === 0 && orchestratorStatus === 'idle') {
    return null;
  }

  const activeAgents = agents.filter(a => a.status === 'processing');
  const hasActivity = orchestratorStatus === 'processing' || activeAgents.length > 0;

  return (
    <div className={`agent-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* Header Row - always visible */}
      <button
        className="agent-panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className="header-left">
          <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
          <div
            className={`status-dot ${hasActivity ? 'pulsing' : ''}`}
            style={{ backgroundColor: statusColors[orchestratorStatus] }}
          />
          <span className="orchestrator-label">
            Orchestrator: {orchestratorStatus === 'processing' ? 'Working...' :
              orchestratorStatus === 'error' ? 'Error' : 'Ready'}
          </span>
        </div>
        <div className="header-right">
          {agents.length > 0 && (
            <span className="agent-count">
              {activeAgents.length > 0
                ? `${activeAgents.length} active`
                : `${agents.length} agent${agents.length !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      </button>

      {/* Expanded Content - Agent Tree */}
      {isExpanded && agents.length > 0 && (
        <div className="agent-tree">
          {agents.map((agent) => (
            <button
              key={agent.name}
              className={`agent-tree-item ${agent.status === 'processing' ? 'active' : ''}`}
              onClick={() => onSelectAgent(agent.name)}
              title="Click to view agent details and chat history"
            >
              <div className="agent-tree-left">
                <span className="tree-indent">└─</span>
                <div
                  className="agent-color-dot"
                  style={{ backgroundColor: agent.color }}
                />
                <div className="agent-info">
                  <span className="agent-name">{agent.name}</span>
                  {agent.role && (
                    <span className="agent-role">{agent.role}</span>
                  )}
                </div>
              </div>
              <div className="agent-tree-right">
                <span
                  className="agent-status-badge"
                  style={{
                    backgroundColor: `${statusColors[agent.status]}20`,
                    color: statusColors[agent.status],
                    borderColor: statusColors[agent.status]
                  }}
                >
                  {agent.status === 'processing' && (
                    <span className="status-dot-inline pulsing" style={{ backgroundColor: statusColors[agent.status] }} />
                  )}
                  {statusLabels[agent.status] || agent.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Collapsed summary - show agent chips inline */}
      {!isExpanded && agents.length > 0 && (
        <div className="agent-chips-collapsed">
          {agents.slice(0, 4).map((agent) => (
            <button
              key={agent.name}
              className="agent-chip-mini"
              onClick={(e) => {
                e.stopPropagation();
                onSelectAgent(agent.name);
              }}
              title={`${agent.name}: ${agent.focus || agent.role || 'Agent'}`}
            >
              <div
                className="agent-color-dot small"
                style={{ backgroundColor: agent.color }}
              />
              <span className="chip-name">{agent.name}</span>
              {agent.status === 'processing' && (
                <span className="status-dot-inline small pulsing" style={{ backgroundColor: statusColors.processing }} />
              )}
            </button>
          ))}
          {agents.length > 4 && (
            <span className="more-agents">+{agents.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  );
}
