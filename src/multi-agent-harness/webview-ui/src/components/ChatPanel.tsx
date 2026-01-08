import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../App';

interface ChatPanelProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  currentTask?: string;
  onStop?: () => void;
  unreadMessages?: number;
  pendingWorkItems?: number;
  contextUsage?: number;
  onSubmitTask?: (task: string) => void;
}

export function ChatPanel({ messages, isProcessing, currentTask, onStop, unreadMessages = 0, pendingWorkItems = 0, contextUsage, onSubmitTask }: ChatPanelProps) {
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
          <span className="chat-panel-icon">&#129302;</span>
          <span>Clautana</span>
          {contextUsage !== undefined && (
            <span className="context-usage-indicator" title={`Context usage: ${contextUsage}%`}>
              Context: {contextUsage}%
            </span>
          )}
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
            {(unreadMessages > 0 || pendingWorkItems > 0) ? (
              <div className="action-items">
                <p>You have pending items:</p>
                <div className="action-buttons">
                  {unreadMessages > 0 && (
                    <button
                      className="action-button"
                      onClick={() => {
                        onSubmitTask?.('Check your inbox and process any unread messages');
                      }}
                      title={`${unreadMessages} unread message${unreadMessages > 1 ? 's' : ''}`}
                    >
                      <span className="action-icon">&#128231;</span>
                      <span className="action-text">
                        Process Unread Emails ({unreadMessages})
                      </span>
                    </button>
                  )}
                  {pendingWorkItems > 0 && (
                    <button
                      className="action-button"
                      onClick={() => {
                        onSubmitTask?.('Review the pending work items on the Kanban board and continue working on them');
                      }}
                      title={`${pendingWorkItems} pending work item${pendingWorkItems > 1 ? 's' : ''}`}
                    >
                      <span className="action-icon">&#9745;</span>
                      <span className="action-text">
                        Continue Work Items ({pendingWorkItems})
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p>Send a task to Clautana to get started</p>
            )}
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
