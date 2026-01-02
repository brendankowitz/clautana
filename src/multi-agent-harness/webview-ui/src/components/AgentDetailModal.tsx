import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { StatusIndicator } from './StatusIndicator';
import type { AgentState } from '../App';

interface AgentDetailModalProps {
  agent: AgentState;
  onClose: () => void;
  onAction: (agentName: string, action: 'pause' | 'resume' | 'stop') => void;
}

export function AgentDetailModal({ agent, onClose, onAction }: AgentDetailModalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [agent.messages]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isPaused = agent.status === 'paused';
  const isIdle = agent.status === 'idle';
  const isProcessing = agent.status === 'processing';
  const isComplete = agent.status === 'complete';
  const hasError = agent.status === 'error';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="agent-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header" style={{ borderColor: agent.color }}>
          <div className="modal-title-section">
            <div
              className="agent-color-indicator"
              style={{ backgroundColor: agent.color }}
            />
            <div className="modal-title-info">
              <h2 className="modal-title">{agent.name}</h2>
              <span className="modal-subtitle">{agent.role}</span>
            </div>
            <StatusIndicator status={agent.status} />
          </div>
          <button className="modal-close-button" onClick={onClose} title="Close (Esc)">
            <span>&#10005;</span>
          </button>
        </div>

        {/* Agent Info */}
        <div className="agent-info-section">
          <div className="info-row">
            <span className="info-label">Focus:</span>
            <span className="info-value">{agent.focus}</span>
          </div>

          {agent.waitingFor.length > 0 && (
            <div className="info-row">
              <span className="info-label">Waiting for:</span>
              <span className="info-value waiting-list">
                {agent.waitingFor.map((dep) => (
                  <span key={dep} className="waiting-badge">{dep}</span>
                ))}
              </span>
            </div>
          )}

          {agent.fileClaims && agent.fileClaims.length > 0 && (
            <div className="info-row file-claims-row">
              <span className="info-label">Files claimed:</span>
              <div className="file-claims-list">
                {agent.fileClaims.map((file) => (
                  <span key={file} className="file-claim-badge">{file}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chat History */}
        <div className="modal-chat-section">
          <div className="modal-chat-header">
            <span>Chat History ({agent.messages.length} messages)</span>
          </div>
          <div className="modal-chat-messages" ref={scrollContainerRef}>
            {agent.messages.length === 0 ? (
              <div className="modal-chat-empty">
                <span>No messages yet</span>
              </div>
            ) : (
              agent.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="modal-actions">
          {isProcessing && (
            <button
              className="action-button pause-button"
              onClick={() => onAction(agent.name, 'pause')}
            >
              <span className="action-icon">&#9208;</span>
              Pause
            </button>
          )}

          {(isPaused || isIdle) && !isComplete && !hasError && (
            <button
              className="action-button resume-button"
              onClick={() => onAction(agent.name, 'resume')}
            >
              <span className="action-icon">&#9654;</span>
              Resume
            </button>
          )}

          {!isComplete && (
            <button
              className="action-button stop-button"
              onClick={() => onAction(agent.name, 'stop')}
            >
              <span className="action-icon">&#9209;</span>
              Stop Agent
            </button>
          )}

          <button className="action-button close-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
