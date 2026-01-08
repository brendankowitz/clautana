import { useState } from 'react';

export interface FileEdit {
  id: string;
  agentName: string;
  filePath: string;
  diff: string;
  timestamp: Date;
  status: 'pending' | 'applied' | 'failed';
  oldContent?: string;
  newContent?: string;
}

interface EditPreviewProps {
  edit: FileEdit;
  onOpenFile: (path: string) => void;
  onOpenDiff?: (edit: FileEdit) => void;
  defaultCollapsed?: boolean;
}

export function EditPreview({ edit, onOpenFile, onOpenDiff, defaultCollapsed = true }: EditPreviewProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getStatusIcon = (status: FileEdit['status']) => {
    switch (status) {
      case 'pending':
        return 'clock';
      case 'applied':
        return 'check';
      case 'failed':
        return 'error';
    }
  };

  const getFileName = (path: string) => {
    return path.split(/[/\\]/).pop() || path;
  };

  const handleOpenDiff = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenDiff) {
      onOpenDiff(edit);
    }
  };

  // Parse diff and render with syntax highlighting
  const renderDiff = () => {
    if (!edit.diff) {
      return <div className="no-diff">No diff available</div>;
    }

    const lines = edit.diff.split('\n');
    return (
      <div className="diff-content">
        {lines.map((line, i) => {
          let lineClass = 'diff-line';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineClass += ' addition';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineClass += ' deletion';
          } else if (line.startsWith('@@')) {
            lineClass += ' hunk-header';
          } else if (line.startsWith('diff') || line.startsWith('index')) {
            lineClass += ' meta';
          }

          return (
            <div key={i} className={lineClass}>
              <span className="line-number">{i + 1}</span>
              <span className="line-content">{line || ' '}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // Generate preview (first few lines of the diff)
  const getPreviewLines = () => {
    if (!edit.diff) return '';
    const lines = edit.diff.split('\n');
    const contentLines = lines.filter(l =>
      (l.startsWith('+') || l.startsWith('-')) &&
      !l.startsWith('+++') &&
      !l.startsWith('---')
    );
    return contentLines.slice(0, 3).join('\n') || lines.slice(0, 2).join('\n');
  };

  return (
    <div className={`edit-preview ${edit.status}`}>
      <div
        className="edit-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span className={`codicon codicon-${isCollapsed ? 'chevron-right' : 'chevron-down'}`}></span>
        <span className={`codicon codicon-${getStatusIcon(edit.status)}`}></span>
        <span
          className="file-name"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFile(edit.filePath);
          }}
          title={edit.filePath}
        >
          {getFileName(edit.filePath)}
        </span>
        <span className="agent-name">{edit.agentName}</span>
        <span className="timestamp">{formatTime(edit.timestamp)}</span>
        <span className={`status-badge ${edit.status}`}>{edit.status}</span>
        {onOpenDiff && edit.diff && (
          <button
            className="open-diff-button"
            onClick={handleOpenDiff}
            title="Open in VS Code diff view"
          >
            <span className="codicon codicon-diff"></span>
            <span>Diff</span>
          </button>
        )}
      </div>

      {isCollapsed && edit.diff && (
        <div className="edit-preview-collapsed">
          <pre>{getPreviewLines()}</pre>
          <span className="expand-hint">Click to expand</span>
        </div>
      )}

      {!isCollapsed && (
        <div className="edit-body">
          <div className="file-path-full">
            <span className="codicon codicon-file"></span>
            <span onClick={() => onOpenFile(edit.filePath)} className="file-link">
              {edit.filePath}
            </span>
            {onOpenDiff && edit.diff && (
              <button
                className="open-diff-button-large"
                onClick={handleOpenDiff}
                title="Open in VS Code diff view"
              >
                <span className="codicon codicon-diff"></span>
                <span>Open in Diff Editor</span>
              </button>
            )}
          </div>
          {renderDiff()}
        </div>
      )}
    </div>
  );
}
