import { useState, useEffect, useCallback } from "react";
import { useVsCodeApi } from "../hooks/useVsCodeApi";
import "./InvestigationBrowser.css";

type WorkflowMode = 'adr' | 'spec-kit' | 'hybrid' | 'auto';
type BrowserViewMode = 'features' | 'investigations' | 'specs' | 'adrs';
type InvestigationStatus = 'exploring' | 'viable' | 'accepted' | 'rejected';
type SpecStatus = 'draft' | 'review' | 'approved' | 'implemented';
type ADRStatus = 'draft' | 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'deprecated';

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

// Column definitions for each view mode with descriptions
interface ColumnDef<T> {
  status: T;
  displayName: string;
  description: string;
}

const INVESTIGATION_COLUMNS: Array<ColumnDef<InvestigationStatus>> = [
  { status: 'exploring', displayName: 'Exploring', description: 'Actively researching options and gathering information' },
  { status: 'viable', displayName: 'Viable', description: 'Found a workable approach, ready for decision' },
  { status: 'accepted', displayName: 'Accepted', description: 'Decision made, promoted to ADR' },
  { status: 'rejected', displayName: 'Rejected', description: 'Approach not viable, documented why' },
];

const SPEC_COLUMNS: Array<ColumnDef<SpecStatus>> = [
  { status: 'draft', displayName: 'Draft', description: 'Initial specification being written' },
  { status: 'review', displayName: 'Review', description: 'Spec under review by stakeholders' },
  { status: 'approved', displayName: 'Approved', description: 'Spec approved, ready for implementation' },
  { status: 'implemented', displayName: 'Implemented', description: 'Implementation complete' },
];

const ADR_COLUMNS: Array<ColumnDef<ADRStatus>> = [
  { status: 'draft', displayName: 'Draft', description: 'ADR being drafted' },
  { status: 'proposed', displayName: 'Proposed', description: 'ADR proposed, awaiting approval' },
  { status: 'accepted', displayName: 'Accepted', description: 'Decision accepted and in effect' },
  { status: 'rejected', displayName: 'Rejected', description: 'Decision rejected' },
  { status: 'superseded', displayName: 'Superseded', description: 'Replaced by a newer ADR' },
];

type AdrSortField = 'updated' | 'created' | 'title' | 'status';
type SortOrder = 'asc' | 'desc';

interface PersistedState {
  selectedFeature: string | null;
  searchQuery: string;
}

export function InvestigationBrowser() {
  const vscode = useVsCodeApi();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [viewMode, setViewMode] = useState<BrowserViewMode>('features');
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('auto');
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);

  // ADR-specific filters and sorting
  const [adrStatusFilter, setAdrStatusFilter] = useState<ADRStatus | ''>('');
  const [adrSortField, setAdrSortField] = useState<AdrSortField>('updated');
  const [adrSortOrder, setAdrSortOrder] = useState<SortOrder>('desc');

  // Search/filter by title
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Loading state
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Restore persisted webview state (filter values)
    const persistedState = vscode.getState() as PersistedState | undefined;
    if (persistedState) {
      if (persistedState.selectedFeature !== undefined) {
        setSelectedFeature(persistedState.selectedFeature);
      }
      if (persistedState.searchQuery !== undefined) {
        setSearchQuery(persistedState.searchQuery);
      }
    }

    // Request initial state from extension
    vscode.postMessage({ type: "getState" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "fullState":
          setFeatures(message.features);
          setViewMode(message.viewMode);
          setWorkflowMode(message.workflowMode);
          setError(null);
          setIsLoading(false);
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

  // Persist filter state when selectedFeature or searchQuery changes
  useEffect(() => {
    const stateToSave: PersistedState = {
      selectedFeature,
      searchQuery,
    };
    vscode.setState(stateToSave);
  }, [selectedFeature, searchQuery, vscode]);

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
      // Note: window.confirm doesn't work reliably in VS Code webviews
      // Just proceed with the action directly
      vscode.postMessage({
        type: "acceptToADR",
        itemId: item.id,
        filePath: item.filePath,
        featureName: item.featureName,
      });
    },
    [vscode]
  );

  const handleArchive = useCallback(
    (item: BrowserItem) => {
      vscode.postMessage({
        type: "archiveInvestigation",
        itemId: item.id,
        filePath: item.filePath,
      });
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

  const handleRefresh = useCallback(() => {
    vscode.postMessage({ type: "getState" });
  }, [vscode]);

  const handleStatusChange = useCallback(
    (itemId: string, newStatus: string) => {
      vscode.postMessage({
        type: "changeItemStatus",
        itemId,
        newStatus,
      });
    },
    [vscode]
  );

  // Get items for current view
  const getItemsForView = (): BrowserItem[] => {
    const items: BrowserItem[] = [];
    const query = searchQuery.toLowerCase().trim();

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

    // Apply search filter by title (case-insensitive)
    if (query) {
      return items.filter((item) => item.title.toLowerCase().includes(query));
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
        return 'Architecture Decision Record Library';
    }
  };

  // Get available view modes based on workflow
  // Note: 'specs' tab hidden until Spec Kit integration is complete
  const getAvailableViewModes = (): BrowserViewMode[] => {
    const baseModes: BrowserViewMode[] = ['features'];

    switch (workflowMode) {
      case 'adr':
        return [...baseModes, 'investigations', 'adrs'];
      case 'spec-kit':
        // When Spec Kit integration is ready, return: [...baseModes, 'specs'];
        return baseModes;
      case 'hybrid':
      case 'auto':
      default:
        // When Spec Kit integration is ready, add 'specs' back
        return [...baseModes, 'investigations', 'adrs'];
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

  if (isLoading) {
    return (
      <div className="investigation-app-container">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p className="loading-text">Loading...</p>
        </div>
      </div>
    );
  }

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
        <div className="investigation-header-actions">
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
          <button
            className="refresh-button icon-button"
            onClick={handleRefresh}
            title="Refresh data"
            aria-label="Refresh data"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335.415-.927 1.341-.927 2.424 0 2.206-1.794 4-4 4s-4-1.794-4-4 1.794-4 4-4c.552 0 1.039.103 1.512.261l-1.512 1.512 4.227.923.923-4.227-1.473 1.473C9.859 3.344 9.077 3 8.001 3 4.687 3 2 5.687 2 9s2.687 6 6 6 6-2.687 6-6c0-1.503-.55-2.879-1.451-3.939l.902-.452z"/>
            </svg>
          </button>
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
              {mode === 'adrs' && '✅ ADR Library'}
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

        <div className="search-filter">
          <input
            type="text"
            id="search-input"
            className="search-input"
            placeholder={viewMode === 'features' ? 'Search features...' : 'Search by title...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {viewMode === 'features' ? (
        <div className="investigation-grid">
          {(() => {
            const query = searchQuery.toLowerCase().trim();
            const filteredFeatures = query
              ? features.filter((f) => f.name.toLowerCase().includes(query))
              : features;

            if (filteredFeatures.length === 0) {
              return (
                <div className="empty-state">
                  <span className="empty-icon">📁</span>
                  <p className="empty-message">No features found</p>
                  <p className="empty-hint">
                    {query ? 'Try a different search term' : 'Use /fn-feature to create your first feature'}
                  </p>
                </div>
              );
            }

            return filteredFeatures.map((feature) => (
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
            ));
          })()}
        </div>
      ) : viewMode === 'adrs' ? (
        <ADRTableView
          adrs={items as ADR[]}
          statusFilter={adrStatusFilter}
          sortField={adrSortField}
          sortOrder={adrSortOrder}
          onStatusFilterChange={setAdrStatusFilter}
          onSortFieldChange={setAdrSortField}
          onSortOrderChange={setAdrSortOrder}
          onItemDoubleClick={handleItemDoubleClick}
        />
      ) : (
        <div className="investigation-board">
          {columns.map((column) => (
            <InvestigationColumn
              key={column.status}
              status={column.status}
              displayName={column.displayName}
              description={column.description}
              items={items.filter((item) => item.status === column.status)}
              viewMode={viewMode}
              onItemDoubleClick={handleItemDoubleClick}
              onSplitIntoTasks={handleSplitIntoTasks}
              onAcceptToADR={handleAcceptToADR}
              onArchive={handleArchive}
              onDrop={handleStatusChange}
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
  description: string;
  items: BrowserItem[];
  viewMode: BrowserViewMode;
  onItemDoubleClick: (item: BrowserItem) => void;
  onSplitIntoTasks: (item: BrowserItem) => void;
  onAcceptToADR: (item: Investigation) => void;
  onArchive: (item: BrowserItem) => void;
  onDrop: (itemId: string, newStatus: string) => void;
}

function InvestigationColumn({
  status,
  displayName,
  description,
  items,
  viewMode,
  onItemDoubleClick,
  onSplitIntoTasks,
  onAcceptToADR,
  onArchive,
  onDrop,
}: InvestigationColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData("text/plain");
    if (itemId) {
      onDrop(itemId, status);
    }
  };

  return (
    <div
      className={`investigation-column ${isDragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="column-header">
        <div className="column-header-top">
          <h3 className="column-title">{displayName}</h3>
          <span className="item-count">{items.length}</span>
        </div>
        <p className="column-description">{description}</p>
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
              onArchive={onArchive}
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
  onArchive?: (item: BrowserItem) => void;
}

function ItemCard({
  item,
  viewMode,
  onDoubleClick,
  onSplitIntoTasks,
  onAcceptToADR,
  onArchive,
}: ItemCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

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
      className={`investigation-card ${getStatusClass(item.status)} ${isDragging ? "dragging" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
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
      </div>

      <div className="card-title">{item.title}</div>

      {'topic' in item && item.topic && (
        <div className="card-topic-subheading">{item.topic}</div>
      )}

      {'summary' in item && item.summary && (
        <div className="card-description">{item.summary}</div>
      )}

      {'decision' in item && item.decision && (
        <div className="card-decision">
          <strong>Decision:</strong> {item.decision}
        </div>
      )}

      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {/* Rejected cards only show archive button */}
        {viewMode === 'investigations' && (item as Investigation).status === 'rejected' ? (
          <button
            className="card-action-button archive-button"
            onClick={() => onArchive && onArchive(item)}
            title="Archive this investigation"
          >
            🗃️ Archive
          </button>
        ) : (
          <>
            {/* Split into Tasks: only for accepted investigations or non-investigation items */}
            {(viewMode !== 'investigations' || (item as Investigation).status === 'accepted') && (
              <button
                className="card-action-button"
                onClick={() => onSplitIntoTasks(item)}
                title="Split into tasks on Kanban board"
              >
                📋 Split into Tasks
              </button>
            )}

            {viewMode === 'investigations' && (item as Investigation).status === 'viable' && (
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

// ADR Table View Component
interface ADRTableViewProps {
  adrs: ADR[];
  statusFilter: ADRStatus | '';
  sortField: AdrSortField;
  sortOrder: SortOrder;
  onStatusFilterChange: (status: ADRStatus | '') => void;
  onSortFieldChange: (field: AdrSortField) => void;
  onSortOrderChange: (order: SortOrder) => void;
  onItemDoubleClick: (item: ADR) => void;
}

function ADRTableView({
  adrs,
  statusFilter,
  sortField,
  sortOrder,
  onStatusFilterChange,
  onSortFieldChange,
  onSortOrderChange,
  onItemDoubleClick,
}: ADRTableViewProps) {
  // Filter ADRs
  const filteredAdrs = statusFilter
    ? adrs.filter((adr) => adr.status === statusFilter)
    : adrs;

  // Sort ADRs
  const sortedAdrs = [...filteredAdrs].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
      case 'created':
        comparison = new Date(a.created).getTime() - new Date(b.created).getTime();
        break;
      case 'updated':
      default:
        comparison = new Date(a.updated).getTime() - new Date(b.updated).getTime();
        break;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  const handleSort = (field: AdrSortField) => {
    if (field === sortField) {
      onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      onSortFieldChange(field);
      onSortOrderChange('desc');
    }
  };

  const getSortIcon = (field: AdrSortField) => {
    if (field !== sortField) return '↕';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  const getStatusBadgeClass = (status: ADRStatus) => {
    switch (status) {
      case 'draft':
        return 'status-badge-draft';
      case 'accepted':
        return 'status-badge-accepted';
      case 'proposed':
        return 'status-badge-proposed';
      case 'rejected':
        return 'status-badge-rejected';
      case 'superseded':
        return 'status-badge-superseded';
      case 'deprecated':
        return 'status-badge-deprecated';
      default:
        return '';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="adr-table-container">
      {/* Filters */}
      <div className="adr-table-filters">
        <div className="filter-group">
          <label htmlFor="adr-status-filter">Status:</label>
          <select
            id="adr-status-filter"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as ADRStatus | '')}
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="proposed">Proposed</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="superseded">Superseded</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </div>
        <div className="adr-count">
          {sortedAdrs.length} ADR{sortedAdrs.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      {sortedAdrs.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📋</span>
          <p className="empty-message">No ADRs found</p>
          <p className="empty-hint">Promote investigations to create ADRs</p>
        </div>
      ) : (
        <table className="adr-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort('title')}>
                Title {getSortIcon('title')}
              </th>
              <th className="sortable" onClick={() => handleSort('status')}>
                Status {getSortIcon('status')}
              </th>
              <th>Feature</th>
              <th className="sortable" onClick={() => handleSort('created')}>
                Created {getSortIcon('created')}
              </th>
              <th className="sortable" onClick={() => handleSort('updated')}>
                Updated {getSortIcon('updated')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAdrs.map((adr) => (
              <tr
                key={adr.id}
                className="adr-row"
                onDoubleClick={() => onItemDoubleClick(adr)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onItemDoubleClick(adr);
                }}
              >
                <td className="adr-title-cell">
                  <span className="adr-title">{adr.title}</span>
                  {adr.decision && (
                    <span className="adr-decision-preview">{adr.decision}</span>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadgeClass(adr.status)}`}>
                    {adr.status}
                  </span>
                </td>
                <td className="adr-feature-cell">{adr.featureName}</td>
                <td className="adr-date-cell">{formatDate(adr.created)}</td>
                <td className="adr-date-cell">{formatDate(adr.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default InvestigationBrowser;
