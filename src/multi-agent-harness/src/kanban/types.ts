export type WorkItemStatus = 'todo' | 'doing' | 'code-review' | 'done' | 'cancelled';
export type WorkItemPriority = 'critical' | 'high' | 'medium' | 'low';
export type WorkItemType = 'story' | 'task';

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  type: WorkItemType;
  assignee: string | null;
  reviewer: string | null;
  tags: string[];
  created: Date;
  started: Date | null;
  completed: Date | null;
  estimatedHours: number | null;
  filePath: string;
  /** Reference to parent feature folder, e.g., "docs/features/kanban-workitems" */
  featureRef?: string;
}

export interface WorkItemCreateInput {
  title: string;
  description: string;
  priority?: WorkItemPriority;
  type?: WorkItemType;
  tags?: string[];
  estimatedHours?: number;
  /** Reference to parent feature folder, e.g., "docs/features/kanban-workitems" */
  featureRef?: string;
  /** Acceptance criteria for the work item */
  acceptanceCriteria?: string;
}

export interface WorkItemUpdateInput {
  title?: string;
  description?: string;
  priority?: WorkItemPriority;
  type?: WorkItemType;
  assignee?: string | null;
  reviewer?: string | null;
  tags?: string[];
  estimatedHours?: number | null;
  /** Reference to parent feature folder, e.g., "docs/features/kanban-workitems" */
  featureRef?: string;
}

export interface WorkItemFrontmatter {
  id: string;
  title: string;
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
  /** Reference to parent feature folder, e.g., "docs/features/kanban-workitems" */
  featureRef?: string;
}

export type TransientTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TransientTodo {
  id: string;
  content: string;
  activeForm: string;
  status: TransientTodoStatus;
  agentName: string;
  createdAt: Date;
  completedAt: Date | null;
  /** Links to parent WorkItem.id (User Story) */
  storyId?: string;
}
