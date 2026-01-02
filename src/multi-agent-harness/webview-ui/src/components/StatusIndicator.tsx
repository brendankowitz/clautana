type Status = 'idle' | 'processing' | 'error' | 'waiting' | 'complete' | 'paused' | 'initializing';

interface StatusIndicatorProps {
  status: Status;
}

const statusConfig: Record<Status, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'status-idle' },
  processing: { label: 'Working', className: 'status-processing' },
  error: { label: 'Error', className: 'status-error' },
  waiting: { label: 'Waiting', className: 'status-waiting' },
  complete: { label: 'Complete', className: 'status-complete' },
  paused: { label: 'Paused', className: 'status-paused' },
  initializing: { label: 'Starting', className: 'status-initializing' },
};

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const config = statusConfig[status] || statusConfig.idle;

  return (
    <span className={`status-indicator ${config.className}`}>
      <span className="status-dot"></span>
      <span className="status-label">{config.label}</span>
    </span>
  );
}
