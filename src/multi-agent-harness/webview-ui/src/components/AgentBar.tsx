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

export function AgentBar({
  orchestratorStatus,
  agents,
  onSelectAgent,
}: AgentBarProps) {
  if (agents.length === 0 && orchestratorStatus === 'idle') {
    return null;
  }

  return (
    <div className="agent-bar">
      {/* Orchestrator Status */}
      <div className="agent-bar-status">
        <div
          className={`status-dot ${orchestratorStatus === 'processing' ? 'pulsing' : ''}`}
          style={{ backgroundColor: statusColors[orchestratorStatus] }}
        />
        <span className="status-label">
          {orchestratorStatus === 'processing' ? 'Working...' :
           orchestratorStatus === 'error' ? 'Error' : 'Ready'}
        </span>
      </div>

      {/* Active Agents */}
      {agents.length > 0 && (
        <div className="agent-bar-agents">
          <span className="agent-bar-divider" />
          <span className="agent-bar-label">Agents:</span>
          {agents.map((agent) => (
            <button
              key={agent.name}
              className="agent-chip"
              onClick={() => onSelectAgent(agent.name)}
              title={`${agent.name}: ${agent.focus}`}
            >
              <div
                className="agent-chip-color"
                style={{ backgroundColor: agent.color }}
              />
              <span className="agent-chip-name">{agent.name}</span>
              <div
                className={`status-dot small ${agent.status === 'processing' ? 'pulsing' : ''}`}
                style={{ backgroundColor: statusColors[agent.status] }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
