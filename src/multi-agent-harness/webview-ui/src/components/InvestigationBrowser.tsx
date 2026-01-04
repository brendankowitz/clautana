import { useState, useEffect, useCallback } from "react";
import { useVsCodeApi } from "../hooks/useVsCodeApi";
import "./InvestigationBrowser.css";

type WorkflowMode = 'adr' | 'spec-kit' | 'hybrid' | 'auto';
type BrowserViewMode = 'features' | 'investigations' | 'specs' | 'adrs';
type InvestigationStatus = 'exploring' | 'viable' | 'planned' | 'rejected';
type SpecStatus = 'draft' | 'review' | 'approved' | 'implemented';
type ADRStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';

interface Investigation {
  id: string;
  featureName: string;
  topic: string;
  title: string;
  status: InvestigationStatus;
  filePath: string;
  created: string;
  updated: string;
  summary?: string;
}

interface Spec {
  id: string;
  featureName: string;
  title: string;
  status: SpecStatus;
  filePath: string;
  created: string;
  updated: string;
  summary?: string;
}

interface ADR {
  id: string;
  featureName: string;
  title: string;
  status: ADRStatus;
  filePath: string;
  created: string;
  updated: string;
  decision?: string;
}

interface Feature {
  name: string;
  path: string;
  investigations: Investigation[];
  specs: Spec[];
  adrs: ADR[];
  created: string;
  updated: string;
}

type BrowserItem = Investigation | Spec | ADR;

// Column definitions for each view mode
const INVESTIGATION_COLUMNS: Array<{ status: InvestigationStatus; displayName: string }> = [
  { status: 'exploring', displayName: 'Exploring' },
  { status: 'viable', displayName: 'Viable' },
  { status: 'planned', displayName: 'Planned' },
  { status: 'rejected', displayName: 'Rejected' },
];

const SPEC_COLUMNS: Array<{ status: SpecStatus; displayName: string }> = [
  { status: 'draft', displayName: 'Draft' },
  { status: 'review', displayName: 'Review' },
  { status: 'approved', displayName: 'Approved' },
  { status: 'implemented', displayName: 'Implemented' },
];

const ADR_COLUMNS: Array<{ status: ADRStatus; displayName: string }> = [
  { status: 'proposed', displayName: 'Proposed' },
  { status: 'accepted', displayName: 'Accepted' },
  { status: 'rejected', displayName: 'Rejected' },
  { status: 'superseded', displayName: 'Superseded' },
];

export function InvestigationBrowser() {
  const vscode = useVsCodeApi();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [viewMode, setViewMode] = useState<BrowserViewMode>('features');
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('auto');
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);

  useEffect(() => {
    // Request initial state
    vscode.postMessage({ type: "getState" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "fullState":
          setFeatures(message.features);
          setViewMode(message.viewMode);
          setWorkflowMode(message.workflowMode);
          setError(null);
          break;

        case "viewChanged":
          setViewMode(message.viewMode);
          break;

        case "error":
          setError(message.message);
          setTimeout(() => setError(null), 5000);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode]);

  const handleItemDoubleClick = useCallback(
    (item: BrowserItem) => {
      vscode.postMessage({
        type: "openItem",
        filePath: item.filePath,
      });
    },
    [vscode]
  );

  const handleSplitIntoTasks = useCallback(
    (item: BrowserItem) => {
      vscode.postMessage({
        type: "splitIntoTasks",
        itemId: item.id,
        filePath: item.filePath,
      });
    },
    [vscode]
  );

  const handleAcceptToADR = useCallback(
    (item: Investigation) => {
      const confirmed = window.confirm(
        `Accept "${item.title}" as ADR?\n\nThis will move the investigation to the ADR folder and mark it as accepted.`
      );
      if (confirmed) {
        vscode.postMessage({
          type: "acceptToADR",
          itemId: item.id,
          filePath: item.filePath,
          featureName: item.featureName,
        });
      }
    },
    [vscode]
  );

  const handleViewChange = useCallback(
    (newViewMode: BrowserViewMode) => {
      setViewMode(newViewMode);
      vscode.postMessage({
        type: "changeView",
        viewMode: newViewMode,
      });
    },
    [vscode]
  );

  const handleCreateInvestigation = useCallback(
    (featureName: string) => {
      vscode.postMessage({
        type: "createInvestigation",
        featureName,
      });
    },
    [vscode]
  );

  // Get items for current view
  const getItemsForView = (): BrowserItem[] => {
    const items: BrowserItem[] = [];

    for (const feature of features) {
      // Apply feature filter if selected
      if (selectedFeature && feature.name !== selectedFeature) {
        continue;
      }

      switch (viewMode) {
        case 'investigations':
          items.push(...feature.investigations);
          break;
        case 'specs':
          items.push(...feature.specs);
          break;
        case 'adrs':
          items.push(...feature.adrs);
          break;
      }
    }

    return items;
  };

  const items = getItemsForView();

  // Get view title
  const getViewTitle = (): string => {
    switch (viewMode) {
      case 'features':
        return 'Features';
      case 'investigations':
        return 'Investigations';
      case 'specs':
        return 'Specifications';
      case 'adrs':
        return 'Architecture Decision Records';
    }
  };

  // Get available view modes based on workflow
  const getAvailableViewModes = (): BrowserViewMode[] => {
    const baseModes: BrowserViewMode[] = ['features'];

    switch (workflowMode) {
      case 'adr':
        return [...baseModes, 'investigations', 'adrs'];
      case 'spec-kit':
        return [...baseModes, 'specs'];
      case 'hybrid':
      case 'auto':
      default:
        return [...baseModes, 'investigations', 'specs', 'adrs'];
    }
  };

  const availableViewModes = getAvailableViewModes();

  // Get columns based on view mode
  const getColumns = () => {
    switch (viewMode) {
      case 'investigations':
        return INVESTIGATION_COLUMNS;
      case 'specs':
        return SPEC_COLUMNS;
      case 'adrs':
        return ADR_COLUMNS;
      default:
        return [];
    }
  };

  const columns = getColumns();

  return (
    <div className="investigation-app-container">
      {error && (
        <div className="investigation-error-banner">
          <span className="error-icon">!</span>
          <span className="error-message">{error}</span>
          <button
            className="error-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            x
          </button>
        </div>
      )}

      <div className="investigation-header">
        <h1 className="investigation-title">{getViewTitle()}</h1>
        <div className="investigation-stats">
          <span className="stat-item">
            <span className="stat-value">{viewMode === 'features' ? features.length : items.length}</span>
            <span className="stat-label">{viewMode === 'features' ? 'Features' : 'Items'}</span>
          </span>
          {viewMode !== 'features' && (
            <span className="stat-item">
              <span className="stat-value">{features.length}</span>
              <span className="stat-label">Features</span>
            </span>
          )}
        </div>
      </div>

      <div className="investigation-controls">
        <div className="view-mode-tabs">
          {availableViewModes.map((mode) => (
            <button
              key={mode}
              className={`view-mode-tab ${viewMode === mode ? 'active' : ''}`}
              onClick={() => handleViewChange(mode)}
            >
              {mode === 'features' && '📁 Features'}
              {mode === 'investigations' && '🔍 Investigations'}
              {mode === 'specs' && '📋 Specs'}
              {mode === 'adrs' && '✅ ADRs'}
            </button>
          ))}
        </div>

        {viewMode !== 'features' && (
          <div className="feature-filter">
            <label htmlFor="feature-select">Feature: </label>
            <select
              id="feature-select"
              value={selectedFeature || ''}
              onChange={(e) => setSelectedFeature(e.target.value || null)}
            >
              <option value="">All Features</option>
              {features.map((feature) => (
                <option key={feature.name} value={feature.name}>
                  {feature.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {viewMode === 'features' ? (
        <div className="investigation-grid">
          {features.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📁</span>
              <p className="empty-message">No features found</p>
              <p className="empty-hint">Use /fn-feature to create your first feature</p>
            </div>
          ) : (
            features.map((feature) => (
              <FeatureCard
                key={feature.name}
                feature={feature}
                onCreateInvestigation={handleCreateInvestigation}
                onDoubleClick={() => {
                  vscode.postMessage({
                    type: "openItem",
                    filePath: feature.path,
                  });
                }}
              />
            ))
          )}
        </div>
      ) : (
        <div className="investigation-board">
          {columns.map((column) => (
            <InvestigationColumn
              key={column.status}
              status={column.status}
              displayName={column.displayName}
              items={items.filter((item) => item.status === column.status)}
              viewMode={viewMode}
              onItemDoubleClick={handleItemDoubleClick}
              onSplitIntoTasks={handleSplitIntoTasks}
              onAcceptToADR={handleAcceptToADR}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FeatureCardProps {
  feature: Feature;
  onCreateInvestigation: (featureName: string) => void;
  onDoubleClick?: () => void;
}

function FeatureCard({ feature, onCreateInvestigation, onDoubleClick }: FeatureCardProps) {
  const updated = new Date(feature.updated);
  const updatedStr = updated.toLocaleDateString();

  const totalItems = feature.investigations.length + feature.specs.length + feature.adrs.length;

  return (
    <div className="item-card feature-card" onDoubleClick={onDoubleClick}>
      <div className="card-header">
        <span className="card-feature-badge">{feature.name}</span>
        <span className="card-stats">
          {totalItems} item{totalItems !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="card-title">{feature.name}</div>

      <div className="feature-card-stats">
        <div className="feature-stat">
          <span className="stat-icon">🔍</span>
          <span className="stat-count">{feature.investigations.length}</span>
          <span className="stat-name">Investigations</span>
        </div>
        <div className="feature-stat">
          <span className="stat-icon">📋</span>
          <span className="stat-count">{feature.specs.length}</span>
          <span className="stat-name">Specs</span>
        </div>
        <div className="feature-stat">
          <span className="stat-icon">✅</span>
          <span className="stat-count">{feature.adrs.length}</span>
          <span className="stat-name">ADRs</span>
        </div>
      </div>

      <div className="card-footer">
        <span className="card-updated">Updated {updatedStr}</span>
      </div>

      <div className="card-actions">
        <button
          className="card-action-button create-investigation-button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateInvestigation(feature.name);
          }}
          title="Create investigation for this feature"
        >
          🔍 Create Investigation
        </button>
      </div>
    </div>
  );
}

interface InvestigationColumnProps {
  status: string;
  displayName: string;
  items: BrowserItem[];
  viewMode: BrowserViewMode;
  onItemDoubleClick: (item: BrowserItem) => void;
  onSplitIntoTasks: (item: BrowserItem) => void;
  onAcceptToADR: (item: Investigation) => void;
}

function InvestigationColumn({
  displayName,
  items,
  viewMode,
  onItemDoubleClick,
  onSplitIntoTasks,
  onAcceptToADR,
}: InvestigationColumnProps) {
  return (
    <div className="investigation-column">
      <div className="column-header">
        <h3 className="column-title">{displayName}</h3>
        <span className="item-count">{items.length}</span>
      </div>
      <div className="column-items">
        {items.length === 0 ? (
          <div className="column-empty">
            <span className="empty-text">No items</span>
          </div>
        ) : (
          items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              viewMode={viewMode}
              onDoubleClick={onItemDoubleClick}
              onSplitIntoTasks={onSplitIntoTasks}
              onAcceptToADR={onAcceptToADR}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ItemCardProps {
  item: BrowserItem;
  viewMode: BrowserViewMode;
  onDoubleClick: (item: BrowserItem) => void;
  onSplitIntoTasks: (item: BrowserItem) => void;
  onAcceptToADR: (item: Investigation) => void;
}

function ItemCard({
  item,
  viewMode,
  onDoubleClick,
  onSplitIntoTasks,
  onAcceptToADR,
}: ItemCardProps) {
  const getStatusClass = (status: string): string => {
    switch (status) {
      case 'exploring':
      case 'draft':
      case 'proposed':
        return 'status-draft';
      case 'viable':
      case 'review':
        return 'status-review';
      case 'planned':
        return 'status-planned';
      case 'accepted':
      case 'approved':
        return 'status-approved';
      case 'rejected':
        return 'status-rejected';
      case 'implemented':
      case 'superseded':
        return 'status-implemented';
      default:
        return '';
    }
  };

  return (
    <div
      className={`investigation-card ${getStatusClass(item.status)}`}
      onDoubleClick={() => onDoubleClick(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onDoubleClick(item);
        }
      }}
    >
      <div className="card-header">
        <span className="card-feature-badge">{item.featureName}</span>
        {'topic' in item && item.topic && (
          <span className="card-topic">{item.topic}</span>
        )}
      </div>

      <div className="card-title">{item.title}</div>

      {'summary' in item && item.summary && (
        <div className="card-description">{item.summary}</div>
      )}

      {'decision' in item && item.decision && (
        <div className="card-decision">
          <strong>Decision:</strong> {item.decision}
        </div>
      )}

      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="card-action-button"
          onClick={() => onSplitIntoTasks(item)}
          disabled={viewMode === 'investigations' && (item as Investigation).status === 'planned'}
          title={viewMode === 'investigations' && (item as Investigation).status === 'planned'
            ? "Already split into tasks"
            : "Split into tasks on Kanban board"}
        >
          📋 Split into Tasks
        </button>

        {viewMode === 'investigations' && (
          <>
            {((item as Investigation).status === 'viable' || (item as Investigation).status === 'planned') && (
              <button
                className="card-action-button accept-button"
                onClick={() => onAcceptToADR(item as Investigation)}
                title="Promote to ADR"
              >
                ✅ Promote to ADR
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default InvestigationBrowser;
