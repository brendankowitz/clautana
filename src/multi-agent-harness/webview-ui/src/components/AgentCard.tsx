import { useState } from 'react';
import type { AgentState } from '../App';

interface AgentCardProps {
  agent: AgentState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSendMessage: (text: string) => void;
}

export function AgentCard({
  agent,
  onPause,
  onResume,
  onStop,
  onSendMessage,
}: AgentCardProps) {
  const [showInput, setShowInput] = useState(false);
  const [message, setMessage] = useState('');

  const getStatusIcon = (status: AgentState['status']) => {
    switch (status) {
      case 'processing':
        return 'sync~spin';
      case 'idle':
        return 'check-all';
      case 'waiting':
        return 'clock';
      case 'paused':
        return 'debug-pause';
      case 'error':
        return 'error';
      case 'complete':
        return 'pass-filled';
      case 'initializing':
        return 'loading~spin';
      default:
        return 'circle';
    }
  };

  const handleSend = () => {
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
      setShowInput(false);
    }
  };

  const isWorking = agent.status === 'processing' || agent.status === 'initializing';

  return (
    <div
      className={`agent-card ${isWorking ? 'working' : ''}`}
      style={{ borderLeftColor: agent.color }}
      data-status={agent.status}
    >
      {isWorking && (
        <div className="agent-progress-bar">
          <div className="progress-bar-fill" style={{ backgroundColor: agent.color }}></div>
        </div>
      )}
      <div className="agent-card-header">
        <div
          className={`agent-color-dot ${isWorking ? 'pulse' : ''}`}
          style={{ backgroundColor: agent.color }}
        />
        <span className="agent-name">{agent.name}</span>
        <span className={`codicon codicon-${getStatusIcon(agent.status)}`} />
      </div>

      <div className="agent-card-role">{agent.role}</div>

      <div className="agent-card-focus" title={agent.focus}>
        {agent.focus.length > 60 ? agent.focus.slice(0, 60) + '...' : agent.focus}
      </div>

      {agent.fileClaims && agent.fileClaims.length > 0 && (
        <div className="agent-claims">
          <span className="codicon codicon-lock" />
          <span>{agent.fileClaims.length} file(s)</span>
        </div>
      )}

      {agent.waitingFor && agent.waitingFor.length > 0 && (
        <div className="agent-waiting">
          <span className="codicon codicon-loading" />
          <span>Waiting for: {agent.waitingFor.join(', ')}</span>
        </div>
      )}

      <div className="agent-card-actions">
        {agent.status === 'paused' ? (
          <button
            className="action-btn resume"
            onClick={onResume}
            title="Resume agent"
          >
            <span className="codicon codicon-debug-continue" />
          </button>
        ) : (
          <button
            className="action-btn pause"
            onClick={onPause}
            title="Pause agent"
            disabled={agent.status === 'complete' || agent.status === 'error'}
          >
            <span className="codicon codicon-debug-pause" />
          </button>
        )}
        <button
          className="action-btn message"
          onClick={() => setShowInput(!showInput)}
          title="Send message"
        >
          <span className="codicon codicon-comment" />
        </button>
        <button
          className="action-btn stop"
          onClick={onStop}
          title="Stop agent"
        >
          <span className="codicon codicon-debug-stop" />
        </button>
      </div>

      {showInput && (
        <div className="agent-message-input">
          <input
            type="text"
            placeholder="Message this agent..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
              if (e.key === 'Escape') setShowInput(false);
            }}
            autoFocus
          />
          <button onClick={handleSend}>
            <span className="codicon codicon-send" />
          </button>
        </div>
      )}
    </div>
  );
}
