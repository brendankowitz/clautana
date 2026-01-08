import { useEffect, useRef } from 'react';

export interface ActivityEntry {
  id: string;
  timestamp: Date;
  agentName: string;
  type: 'text' | 'toolCall' | 'toolResult' | 'message' | 'error';
  content: string;
  filePath?: string;
}

interface ActivityStreamProps {
  entries: ActivityEntry[];
  onOpenFile: (path: string) => void;
}

export function ActivityStream({ entries, onOpenFile }: ActivityStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // Auto-scroll if user is near the bottom
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getTypeIcon = (type: ActivityEntry['type']) => {
    switch (type) {
      case 'text':
        return 'chat';
      case 'toolCall':
        return 'symbol-method';
      case 'toolResult':
        return 'check';
      case 'message':
        return 'mail';
      case 'error':
        return 'error';
      default:
        return 'circle';
    }
  };

  // Extract file paths from content
  const renderContent = (entry: ActivityEntry) => {
    const filePathRegex = /(?:^|\s)((?:\/|[A-Za-z]:)[^\s]+\.[a-zA-Z0-9]+)/g;
    const parts: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match;

    const content = entry.content;
    while ((match = filePathRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      const filePath = match[1];
      parts.push(
        <span
          key={match.index}
          className="file-link"
          onClick={() => onOpenFile(filePath)}
          title={`Open ${filePath}`}
        >
          {filePath}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  };

  return (
    <div
      className="activity-stream"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {entries.length === 0 ? (
        <div className="empty-state">
          <span className="codicon codicon-pulse"></span>
          <p>Waiting for agent activity...</p>
        </div>
      ) : (
        entries.map(entry => (
          <div
            key={entry.id}
            className={`activity-entry ${entry.type}`}
          >
            <div className="entry-header">
              <span className={`codicon codicon-${getTypeIcon(entry.type)}`}></span>
              <span className="agent-name">{entry.agentName}</span>
              <span className="entry-type">{entry.type}</span>
              <span className="timestamp">{formatTime(entry.timestamp)}</span>
            </div>
            <div className="entry-content">
              {renderContent(entry)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
