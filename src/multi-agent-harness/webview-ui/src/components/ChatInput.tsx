import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface SlashCommand {
  name: string;
  description: string;
  args?: string;
}

interface ChatInputProps {
  onSubmit: (message: string) => void;
  isProcessing: boolean;
  queueLength?: number;
  placeholder?: string;
}

export function ChatInput({ onSubmit, isProcessing, queueLength = 0, placeholder = 'Describe a task...' }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [availableCommands, setAvailableCommands] = useState<SlashCommand[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Request slash commands from extension when value starts with "/"
  useEffect(() => {
    if (value.startsWith('/') && typeof window !== 'undefined' && (window as any).vscode) {
      const vscode = (window as any).vscode;
      const prefix = value.slice(1);
      vscode.postMessage({
        type: 'getSlashCommandCompletions',
        prefix
      });
    }
  }, [value]);

  // Listen for slash command completions from extension
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).vscode) return;

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'slashCommandCompletions') {
        setAvailableCommands(message.completions || []);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const filteredCommands = useMemo(() => {
    if (!value.startsWith('/')) return [];
    const filter = value.slice(1).toLowerCase();
    return availableCommands.filter(cmd =>
      cmd.name.toLowerCase().includes(filter) ||
      cmd.description.toLowerCase().includes(filter)
    );
  }, [value, availableCommands]);

  useEffect(() => {
    if (value.startsWith('/') && filteredCommands.length > 0) {
      setShowCommands(true);
      setSelectedIndex(0);
    } else {
      setShowCommands(false);
    }
  }, [value, filteredCommands.length]);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }
  }, [value]);

  useEffect(() => {
    if (showCommands && dropdownRef.current) {
      const el = dropdownRef.current.querySelector('.command-item.selected');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, showCommands]);

  const selectCommand = useCallback((command: SlashCommand) => {
    // Keep the "/" prefix when selecting a command
    setValue('/' + command.name + ' ');
    setShowCommands(false);
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      // Check if it's a slash command
      if (trimmed.startsWith('/')) {
        // Execute as slash command
        const vscode = (window as any).vscode;
        vscode?.postMessage({ type: 'executeSlashCommand', command: trimmed });
      } else {
        // Submit as regular task
        onSubmit(trimmed);
      }
      setValue('');
      setShowCommands(false);
    }
  }, [value, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(p => p < filteredCommands.length - 1 ? p + 1 : 0);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(p => p > 0 ? p - 1 : filteredCommands.length - 1);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectCommand(filteredCommands[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value);
  const handleBlur = () => setTimeout(() => setShowCommands(false), 150);
  const canSubmit = value.trim().length > 0;
  const willQueue = isProcessing && canSubmit;

  return (
    <div className="chat-input-container">
      {showCommands && filteredCommands.length > 0 && (
        <div className="command-dropdown" ref={dropdownRef}>
          <div className="command-category">
            {filteredCommands.map((cmd, idx) => (
              <div
                key={cmd.name}
                className={`command-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => selectCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="command-name">{cmd.name}</span>
                <span className="command-description">
                  {cmd.description}
                  {cmd.args && <span className="command-args"> {cmd.args}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="command-hint">
            <kbd>↑↓</kbd> navigate <kbd>Tab</kbd> select <kbd>Esc</kbd> close
          </div>
        </div>
      )}
      {queueLength > 0 && (
        <div className="queue-indicator">
          <span className="queue-icon">⏳</span>
          <span className="queue-text">{queueLength} command{queueLength > 1 ? 's' : ''} queued</span>
        </div>
      )}
      <div className="chat-input-wrapper">
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={isProcessing ? 'Type to queue another command...' : placeholder}
          rows={1}
        />
        <button
          className="chat-send-button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={willQueue ? 'Queue command (Enter)' : 'Send message (Enter)'}
        >
          {willQueue ? (
            <span className="queue-badge">+Q</span>
          ) : (
            <svg className="send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
      <div className="chat-input-hint">
        {isProcessing ? (
          <>Commands will be <strong>queued</strong> while processing</>
        ) : (
          <>Type <kbd>/</kbd> for commands, <kbd>Enter</kbd> to send</>
        )}
      </div>
    </div>
  );
}
