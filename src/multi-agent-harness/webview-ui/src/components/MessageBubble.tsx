import { useState } from 'react';
import type { ChatMessage } from '../App';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [isToolExpanded, setIsToolExpanded] = useState(false);

  // Skip empty messages
  if (!message.content && !message.toolCall) {
    return null;
  }

  const timestamp = message.timestamp instanceof Date
    ? message.timestamp
    : new Date(message.timestamp);

  const timeString = timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  // Tool call message
  if (message.role === 'tool') {
    if (message.toolCall) {
      return (
        <div className="message-bubble message-tool">
          <div className="tool-content">
            <button
              className="tool-call-header"
              onClick={() => setIsToolExpanded(!isToolExpanded)}
            >
              <span className="expand-icon">{isToolExpanded ? '▼' : '▶'}</span>
              <span className="tool-name">{message.toolCall.name}</span>
              {message.toolCall.isError && (
                <span className="tool-error-badge">Error</span>
              )}
            </button>

            {isToolExpanded && (
              <div className="tool-call-details">
                <div className="tool-section">
                  <div className="tool-section-label">Arguments</div>
                  <pre className="tool-code">
                    {JSON.stringify(message.toolCall.arguments, null, 2)}
                  </pre>
                </div>
                {message.toolCall.result !== undefined && (
                  <div className="tool-section">
                    <div className="tool-section-label">Result</div>
                    <pre className="tool-code">
                      {typeof message.toolCall.result === 'string'
                        ? message.toolCall.result
                        : JSON.stringify(message.toolCall.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <span className="message-time">{timeString}</span>
          </div>
        </div>
      );
    }

    // Tool message without toolCall data - show as simple tool indicator
    if (message.content) {
      return (
        <div className="message-bubble message-tool">
          <div className="tool-content">
            <div className="tool-call-header">
              <span className="expand-icon">▶</span>
              <span className="tool-name">{message.content}</span>
            </div>
            <span className="message-time">{timeString}</span>
          </div>
        </div>
      );
    }

    // Empty tool message - skip
    return null;
  }

  // System message
  if (message.role === 'system') {
    return (
      <div className="message-bubble message-system">
        <span className="system-icon">⚙️</span>
        <span className="system-content">{message.content}</span>
        <span className="message-time">{timeString}</span>
      </div>
    );
  }

  // User message
  if (message.role === 'user') {
    return (
      <div className="message-bubble message-user">
        <div className="message-content">
          <MarkdownContent content={message.content} />
        </div>
        <span className="message-time">{timeString}</span>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="message-bubble message-assistant">
      <div className="assistant-avatar">🤖</div>
      <div className="message-body">
        <div className="message-content">
          <MarkdownContent content={message.content} />
        </div>
        <span className="message-time">{timeString}</span>
      </div>
    </div>
  );
}

interface MarkdownContentProps {
  content: string;
}

function MarkdownContent({ content }: MarkdownContentProps) {
  // Simple markdown rendering for code blocks
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`)/g);

  return (
    <>
      {parts.map((part, index) => {
        // Multi-line code block
        if (part.startsWith('```')) {
          const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
          if (match) {
            const [, language, code] = match;
            return (
              <pre key={index} className="code-block" data-language={language || undefined}>
                <code>{code.trim()}</code>
              </pre>
            );
          }
        }

        // Inline code
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={index} className="inline-code">
              {part.slice(1, -1)}
            </code>
          );
        }

        // Regular text - render with basic formatting
        return <span key={index}>{renderTextWithFormatting(part)}</span>;
      })}
    </>
  );
}

function renderTextWithFormatting(text: string): React.ReactNode[] {
  // Handle bold, italic, and line breaks
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push(<br key={`br-${lineIndex}`} />);
    }

    // Simple bold handling (**text**)
    const boldParts = line.split(/(\*\*[^*]+\*\*)/g);
    boldParts.forEach((part, partIndex) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        nodes.push(
          <strong key={`${lineIndex}-${partIndex}`}>
            {part.slice(2, -2)}
          </strong>
        );
      } else {
        nodes.push(part);
      }
    });
  });

  return nodes;
}
