import { useState, useEffect, useCallback } from "react";
import { useVsCodeApi } from "../hooks/useVsCodeApi";
import "./KanbanBoard.css";

type WorkItemStatus = "todo" | "doing" | "code-review" | "done" | "cancelled";
type WorkItemPriority = "critical" | "high" | "medium" | "low";
type WorkItemType = "story" | "task";
type TransientTodoStatus = "pending" | "in_progress" | "completed";

interface WorkItem {
  id: string;
  title: string;
  description: string;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  type: WorkItemType;
  assignee: string | null;
  reviewer: string | null;
  tags: string[];
  created: string;
  started: string | null;
  completed: string | null;
  estimatedHours: number | null;
  filePath: string;
  /** Reference to parent feature folder */
  featureRef?: string;
}

interface TransientTodo {
  id: string;
  content: string;
  activeForm: string;
  status: TransientTodoStatus;
  agentName: string;
  createdAt: string;
  completedAt: string | null;
  /** Links to parent WorkItem.id (User Story) */
  storyId?: string;
}

interface KanbanColumnProps {
  status: WorkItemStatus;
  displayName: string;
  items: WorkItem[];
  transientTodos: TransientTodo[];
  assigningItemIds: Set<string>;
  onDrop: (itemId: string, newStatus: WorkItemStatus) => void;
  onItemDoubleClick: (item: WorkItem) => void;
  onItemDelete: (item: WorkItem) => void;
  onItemArchive: (item: WorkItem) => void;
  onItemAssign: (item: WorkItem) => void;
  onItemEdit: (item: WorkItem) => void;
  /** For todo column: callback to start work */
  onStartWork?: () => void;
  /** For todo column: whether start work button is enabled */
  canStartWork?: boolean;
}

interface KanbanCardProps {
  item: WorkItem;
  isAssigning: boolean;
  onDoubleClick: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  onArchive: (item: WorkItem) => void;
  onAssign: (item: WorkItem) => void;
  onEdit: (item: WorkItem) => void;
}

interface TransientTodoCardProps {
  todo: TransientTodo;
  isRemoving?: boolean;
}

const COLUMNS: Array<{ status: WorkItemStatus; displayName: string }> = [
  { status: "todo", displayName: "To Do" },
  { status: "doing", displayName: "In Progress" },
  { status: "code-review", displayName: "Review" },
  { status: "done", displayName: "Done" },
];

type OrchestratorStatus = 'idle' | 'processing' | 'error';

export function KanbanBoard() {
  const vscode = useVsCodeApi();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [transientTodos, setTransientTodos] = useState<TransientTodo[]>([]);
  const [removingTodoIds, setRemovingTodoIds] = useState<Set<string>>(new Set());
  const [assigningItemIds, setAssigningItemIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus>('idle');

  // Filters
  const [searchText, setSearchText] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<WorkItemPriority | "">("");
  const [filterFeature, setFilterFeature] = useState<string>("");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showTagsDropdown, setShowTagsDropdown] = useState<boolean>(false);

  useEffect(() => {
    // Request initial state
    vscode.postMessage({ type: "getState" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "fullState":
          setItems(message.items);
          setTransientTodos(message.transientTodos || []);
          if (message.orchestratorStatus) {
            setOrchestratorStatus(message.orchestratorStatus);
          }
          setError(null);
          break;

        case "orchestratorStatus":
          setOrchestratorStatus(message.status);
          break;

        case "itemCreated":
          setItems((prev) => [...prev, message.item]);
          break;

        case "itemMoved":
          console.log('[KanbanBoard] Received itemMoved message:', message.item.id, 'new status:', message.item.status);
          setItems((prev) => {
            const updated = prev.map((item) =>
              item.id === message.item.id ? message.item : item
            );
            console.log('[KanbanBoard] Items after update:', updated.map(i => `${i.id}:${i.status}`));
            return updated;
          });
          // Clear assigning state when item is updated
          setAssigningItemIds((prev) => {
            const next = new Set(prev);
            next.delete(message.item.id);
            return next;
          });
          break;
        case "itemUpdated":
          console.log('[KanbanBoard] Received itemUpdated message:', message.item.id, 'status:', message.item.status);
          setItems((prev) =>
            prev.map((item) =>
              item.id === message.item.id ? message.item : item
            )
          );
          // Clear assigning state when item is updated
          setAssigningItemIds((prev) => {
            const next = new Set(prev);
            next.delete(message.item.id);
            return next;
          });
          break;

        case "itemDeleted":
          setItems((prev) => prev.filter((item) => item.id !== message.itemId));
          break;

        case "itemCancelled":
          setItems((prev) =>
            prev.map((item) =>
              item.id === message.item.id ? message.item : item
            )
          );
          break;

        case "transientTodoAdded":
          setTransientTodos((prev) => [...prev, message.todo]);
          break;

        case "transientTodoUpdated":
          setTransientTodos((prev) =>
            prev.map((todo) =>
              todo.id === message.todo.id ? message.todo : todo
            )
          );
          break;

        case "transientTodoRemoved":
          // Trigger fade-out animation before removing
          setRemovingTodoIds((prev) => new Set(prev).add(message.todoId));
          setTimeout(() => {
            setTransientTodos((prev) =>
              prev.filter((todo) => todo.id !== message.todoId)
            );
            setRemovingTodoIds((prev) => {
              const next = new Set(prev);
              next.delete(message.todoId);
              return next;
            });
          }, 300); // Match CSS animation duration
          break;

        case "error":
          setError(message.message);
          // Auto-clear error after 5 seconds
          setTimeout(() => setError(null), 5000);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode]);

  const handleDrop = useCallback(
    (itemId: string, newStatus: WorkItemStatus) => {
      // Optimistic update
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, status: newStatus } : item
        )
      );

      vscode.postMessage({
        type: "moveItem",
        itemId,
        newStatus,
      });
    },
    [vscode]
  );

  const handleDoubleClick = useCallback(
    (item: WorkItem) => {
      vscode.postMessage({
        type: "openItem",
        filePath: item.filePath,
      });
    },
    [vscode]
  );

  const handleDelete = useCallback(
    (item: WorkItem) => {
      // Optimistic update - remove from UI immediately
      setItems((prev) => prev.filter((i) => i.id !== item.id));

      // Send delete message to backend
      vscode.postMessage({
        type: "deleteItem",
        itemId: item.id,
      });
    },
    [vscode]
  );

  const handleArchive = useCallback(
    (item: WorkItem) => {
      // Optimistic update - remove from UI immediately
      setItems((prev) => prev.filter((i) => i.id !== item.id));

      // Send archive message to backend
      vscode.postMessage({
        type: "archiveItem",
        itemId: item.id,
      });
    },
    [vscode]
  );

  const handleAssign = useCallback(
    (item: WorkItem) => {
      // Mark item as assigning immediately for UI feedback
      setAssigningItemIds((prev) => new Set(prev).add(item.id));

      vscode.postMessage({
        type: "assignItem",
        itemId: item.id,
      });
    },
    [vscode]
  );

  const handleEdit = useCallback(
    (item: WorkItem) => {
      vscode.postMessage({
        type: "openItem",
        filePath: item.filePath,
      });
    },
    [vscode]
  );

  const handleStartWork = useCallback(() => {
    vscode.postMessage({
      type: "submitTask",
      task: "Review the pending work items on the Kanban board and continue working on them",
    });
  }, [vscode]);

  // Filter out cancelled items from the main board
  // Apply filters
  const filteredItems = items.filter((item) => {
    // Text search (searches title, description, id)
    if (searchText) {
      const search = searchText.toLowerCase();
      const matchesText =
        item.title.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search) ||
        item.id.toLowerCase().includes(search) ||
        item.assignee?.toLowerCase().includes(search) ||
        false;
      if (!matchesText) return false;
    }

    // Priority filter
    if (filterPriority && item.priority !== filterPriority) {
      return false;
    }

    // Feature filter
    if (filterFeature) {
      if (!item.featureRef || !item.featureRef.includes(filterFeature)) {
        return false;
      }
    }

    // Tags filter (item must have ALL selected tags)
    if (filterTags.length > 0) {
      const hasAllTags = filterTags.every(tag => item.tags.includes(tag));
      if (!hasAllTags) return false;
    }

    return true;
  });

  const activeItems = filteredItems.filter((item) => item.status !== "cancelled");
  const cancelledItems = filteredItems.filter((item) => item.status === "cancelled");

  // Get unique features and tags for filter dropdowns
  const allFeatures = Array.from(
    new Set(
      items
        .map((item) => item.featureRef)
        .filter((ref): ref is string => !!ref)
    )
  ).sort();

  const allTags = Array.from(
    new Set(items.flatMap((item) => item.tags))
  ).sort();

  // Clear filters function
  const clearFilters = () => {
    setSearchText("");
    setFilterPriority("");
    setFilterFeature("");
    setFilterTags([]);
  };

  // Check if any filters are active
  const hasActiveFilters =
    searchText !== "" ||
    filterPriority !== "" ||
    filterFeature !== "" ||
    filterTags.length > 0;

  // Map transient todo status to work item status for column placement
  const getTransientTodosForColumn = (columnStatus: WorkItemStatus): TransientTodo[] => {
    const statusMap: Record<TransientTodoStatus, WorkItemStatus> = {
      pending: "todo",
      in_progress: "doing",
      completed: "done",
    };

    return transientTodos
      .filter((todo) => statusMap[todo.status] === columnStatus)
      .map((todo) => ({
        ...todo,
        isRemoving: removingTodoIds.has(todo.id),
      }));
  };

  const totalTransientTodos = transientTodos.length;

  return (
    <div className="kanban-app-container">
      {error && (
        <div className="kanban-error-banner">
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

      <div className="kanban-header">
        <h1 className="kanban-title">User Stories</h1>
        <div className="kanban-stats">
          <span className="stat-item">
            <span className="stat-value">{activeItems.length}</span>
            <span className="stat-label">Stories</span>
          </span>
          {totalTransientTodos > 0 && (
            <span className="stat-item stat-transient">
              <span className="stat-value">{totalTransientTodos}</span>
              <span className="stat-label">Tasks</span>
            </span>
          )}
          {cancelledItems.length > 0 && (
            <span className="stat-item stat-cancelled">
              <span className="stat-value">{cancelledItems.length}</span>
              <span className="stat-label">Cancelled</span>
            </span>
          )}
        </div>
      </div>

      <div className="kanban-filters">
        <input
          type="text"
          className="filter-search"
          placeholder="Search stories..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          aria-label="Search stories"
        />

        <select
          className="filter-select"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as WorkItemPriority | "")}
          aria-label="Filter by priority"
        >
          <option value="">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {allFeatures.length > 0 && (
          <select
            className="filter-select"
            value={filterFeature}
            onChange={(e) => setFilterFeature(e.target.value)}
            aria-label="Filter by feature"
          >
            <option value="">All Features</option>
            {allFeatures.map((feature) => (
              <option key={feature} value={feature}>
                {feature.split('/').pop()}
              </option>
            ))}
          </select>
        )}

        {allTags.length > 0 && (
          <div className="filter-tags-container">
            <button
              className="filter-tags-button"
              onClick={() => setShowTagsDropdown(!showTagsDropdown)}
              aria-label="Filter by tags"
            >
              Tags {filterTags.length > 0 && `(${filterTags.length})`}
            </button>
            {showTagsDropdown && (
              <div className="filter-tags-dropdown">
                {allTags.map((tag) => (
                  <label key={tag} className="filter-tag-option">
                    <input
                      type="checkbox"
                      checked={filterTags.includes(tag)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFilterTags([...filterTags, tag]);
                        } else {
                          setFilterTags(filterTags.filter(t => t !== tag));
                        }
                      }}
                    />
                    <span>{tag}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <button
            className="filter-clear"
            onClick={clearFilters}
            aria-label="Clear all filters"
            title="Clear all filters"
          >
            Clear Filters
          </button>
        )}
      </div>

      <div className="kanban-board">
        {COLUMNS.map((column) => {
          const columnItems = activeItems.filter((item) => item.status === column.status);
          return (
            <KanbanColumn
              key={column.status}
              status={column.status}
              displayName={column.displayName}
              items={columnItems}
              transientTodos={getTransientTodosForColumn(column.status)}
              assigningItemIds={assigningItemIds}
              onDrop={handleDrop}
              onItemDoubleClick={handleDoubleClick}
              onItemDelete={handleDelete}
              onItemArchive={handleArchive}
              onItemAssign={handleAssign}
              onItemEdit={handleEdit}
              {...(column.status === 'todo' ? {
                onStartWork: handleStartWork,
                canStartWork: orchestratorStatus === 'idle' && columnItems.length > 0,
              } : {})}
            />
          );
        })}
      </div>

      {cancelledItems.length > 0 && (
        <div className="kanban-cancelled-section">
          <h2 className="cancelled-header">Cancelled Items</h2>
          <div className="cancelled-items">
            {cancelledItems.map((item) => (
              <div key={item.id} className="cancelled-item">
                <span className="cancelled-item-id">{item.id}</span>
                <span className="cancelled-item-title">{item.title}</span>
                <button
                  className="cancelled-item-delete"
                  onClick={() => handleDelete(item)}
                  title="Delete permanently"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  status,
  displayName,
  items,
  transientTodos,
  assigningItemIds,
  onDrop,
  onItemDoubleClick,
  onItemDelete,
  onItemArchive,
  onItemAssign,
  onItemEdit,
  onStartWork,
  canStartWork,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only set to false if leaving the column entirely
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

  const totalCount = items.length + transientTodos.length;

  return (
    <div
      className={`kanban-column ${isDragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="column-header">
        <div className="column-title-row">
          <h3 className="column-title">{displayName}</h3>
          {onStartWork && (
            <button
              className={`start-work-button ${canStartWork ? '' : 'disabled'}`}
              onClick={onStartWork}
              disabled={!canStartWork}
              title={canStartWork ? `Continue working on ${items.length} item${items.length !== 1 ? 's' : ''}` : "Orchestrator is busy"}
              aria-label="Continue work items"
            >
              <span className="play-icon">▶</span>
            </button>
          )}
        </div>
        <span className="item-count">{totalCount}</span>
      </div>
      <div className="column-items">
        {totalCount === 0 ? (
          <div className="column-empty">
            <span className="empty-text">No items</span>
          </div>
        ) : (
          <>
            {/* Persistent work items first */}
            {items.map((item) => (
              <KanbanCard
                key={item.id}
                item={item}
                isAssigning={assigningItemIds.has(item.id)}
                onDoubleClick={onItemDoubleClick}
                onDelete={onItemDelete}
                onArchive={onItemArchive}
                onAssign={onItemAssign}
                onEdit={onItemEdit}
              />
            ))}
            {/* Transient todos below work items */}
            {transientTodos.map((todo) => (
              <TransientTodoCard
                key={todo.id}
                todo={todo}
                isRemoving={(todo as any).isRemoving}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  item,
  isAssigning,
  onDoubleClick,
  onDelete,
  onArchive,
  onAssign,
  onEdit,
}: KanbanCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  // Debug: Log when card is rendered
  console.log(`[KanbanCard] Rendered card ${item.id} in status ${item.status}, onDelete is:`, typeof onDelete);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const priorityLabels: Record<WorkItemPriority, string> = {
    critical: "CRITICAL",
    high: "HIGH",
    medium: "MED",
    low: "LOW",
  };

  return (
    <div
      className={`kanban-card priority-${item.priority} ${isDragging ? "dragging" : ""}`}
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
        <span className="card-id">{item.id}</span>
        <span className={`priority-badge priority-${item.priority}`}>
          {priorityLabels[item.priority]}
        </span>
      </div>

      {item.featureRef && (
        <div className="card-feature-badge" title={`Feature: ${item.featureRef}`}>
          <span className="feature-icon" aria-hidden="true">F</span>
          <span className="feature-name">{item.featureRef.split('/').pop()}</span>
        </div>
      )}

      <div className="card-title">{item.title}</div>

      {item.description && (
        <div className="card-description">{item.description}</div>
      )}

      {item.assignee && (
        <div className="card-assignee">
          <span className="assignee-icon" aria-hidden="true">
            @
          </span>
          <span className="assignee-name">{item.assignee}</span>
        </div>
      )}

      {item.reviewer && (
        <div className="card-reviewer">
          <span className="reviewer-icon" aria-hidden="true">
            R
          </span>
          <span className="reviewer-name">{item.reviewer}</span>
        </div>
      )}

      {item.tags.length > 0 && (
        <div className="card-tags">
          {item.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {item.estimatedHours !== null && (
        <div className="card-estimate" title="Estimated agent hours">
          <span className="estimate-icon" aria-hidden="true">
            ~
          </span>
          <span className="estimate-value">{item.estimatedHours} agent hrs</span>
        </div>
      )}

      <div className="card-actions">
        {item.status === "done" ? (
          /* Done column: only show Archive button */
          <button
            className="card-action-button archive-button"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(item);
            }}
            title="Archive item"
            aria-label="Archive item"
          >
            Archive
          </button>
        ) : (
          /* Other columns: show Assign, Edit, Delete */
          <>
            {(() => {
              const hasAssignee = item.assignee !== null && item.assignee !== undefined;
              const hasReviewer = item.reviewer !== null && item.reviewer !== undefined;
              const isActivelyWorking = item.status === "doing" || item.status === "code-review";
              const isDisabled = isAssigning || ((hasAssignee || hasReviewer) && isActivelyWorking);

              let buttonText = "Assign";
              if (isAssigning) {
                buttonText = "Assigning...";
              } else if ((hasAssignee || hasReviewer) && !isActivelyWorking) {
                buttonText = "Resume";
              }

              return (
                <button
                  className="card-action-button assign-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssign(item);
                  }}
                  disabled={isDisabled}
                  title={isAssigning ? "Assigning to orchestrator..." : (isDisabled ? "Already assigned and in progress" : buttonText)}
                  aria-label={buttonText}
                >
                  {buttonText}
                </button>
              );
            })()}
            <button
              className="card-action-button edit-button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
              title="Edit item"
              aria-label="Edit item"
            >
              Edit
            </button>
            <button
              className="card-action-button delete-button"
              onClick={(e) => {
                console.log('[KanbanCard] Delete button CLICKED!', item.id);
                e.stopPropagation();
                console.log('[KanbanCard] About to call onDelete');
                onDelete(item);
                console.log('[KanbanCard] onDelete called');
              }}
              title="Delete permanently"
              aria-label="Delete item"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * TransientTodoCard component for displaying agent Task items.
 * These are ephemeral tasks from Claude Code's TodoWrite tool.
 * Tasks may be linked to a parent User Story via storyId.
 */
function TransientTodoCard({ todo, isRemoving }: TransientTodoCardProps) {
  const statusClasses: Record<TransientTodoStatus, string> = {
    pending: "status-pending",
    in_progress: "status-in-progress",
    completed: "status-completed",
  };

  const classNames = [
    "transient-todo-card",
    statusClasses[todo.status],
    isRemoving ? "removing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} role="listitem">
      <div className="transient-todo-header">
        <span className="transient-todo-agent">
          Agent: {todo.agentName}
        </span>
        {todo.storyId && (
          <span className="transient-todo-story" title={`Story: ${todo.storyId}`}>
            {todo.storyId}
          </span>
        )}
        {todo.status === "in_progress" && (
          <span className="transient-todo-pulse" aria-label="In progress" />
        )}
      </div>
      <div className="transient-todo-content">
        {todo.status === "in_progress" ? todo.activeForm : todo.content}
      </div>
    </div>
  );
}

export default KanbanBoard;
