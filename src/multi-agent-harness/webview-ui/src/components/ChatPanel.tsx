import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../App';

interface ChatPanelProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  currentTask?: string;
  onStop?: () => void;
}

export function ChatPanel({ messages, isProcessing, currentTask, onStop }: ChatPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (wasAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Track if user is scrolled to bottom
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 50;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < threshold;
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <div className="chat-panel-title">
          <span className="chat-panel-icon">&#127919;</span>
          <span>Orchestrator</span>
        </div>
        {isProcessing && onStop && (
          <button className="stop-button" onClick={onStop} title="Stop all agents">
            <span className="stop-icon">&#9209;</span>
            <span>Stop</span>
          </button>
        )}
      </div>

      {currentTask && (
        <div className="current-task-banner">
          <span className="task-label">Current Task:</span>
          <span className="task-text">{currentTask}</span>
        </div>
      )}

      <div
        className="chat-messages-container"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <div className="empty-icon">&#128172;</div>
            <h3>No messages yet</h3>
            <p>Send a task to the orchestrator to get started</p>
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}

        {isProcessing && (
          <div className="processing-indicator">
            <div className="typing-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className="processing-text">Processing...</span>
          </div>
        )}
      </div>
    </div>
  );
}
