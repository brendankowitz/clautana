import { useState, useEffect, useMemo } from "react";
import { useVsCodeApi } from "../hooks/useVsCodeApi";
import "./KnowledgeExplorer.css";

interface Fact {
  id: string;
  category: string;
  statement: string;
  source?: string;
  createdAt: string;
  lastVerified: string;
  confidence: number;
}

interface SessionLog {
  id: string;
  startTime: string;
  endTime?: string;
  task: string;
  agents: string[];
  outcome: "success" | "partial" | "failure";
  summary?: string;
  filesChanged: string[];
  lessonsLearned?: string[];
}

interface Playbook {
  id: string;
  title: string;
  description: string;
  steps: string[];
  tags: string[];
  createdAt: string;
  lastUsed: string;
  useCount: number;
  confidence: number;
}

interface KnowledgeData {
  facts: Fact[];
  sessions: SessionLog[];
  playbooks: Playbook[];
}

type TabType = "facts" | "sessions" | "playbooks";

const CATEGORY_COLORS: Record<string, string> = {
  architecture: "#3B82F6",
  patterns: "#10B981",
  gotchas: "#EF4444",
  dependencies: "#F59E0B",
  conventions: "#8B5CF6",
  requirement: "#EC4899",
  integration: "#06B6D4",
  lesson: "#84CC16",
};

const OUTCOME_COLORS: Record<string, string> = {
  success: "#10B981",
  partial: "#F59E0B",
  failure: "#EF4444",
};

export function KnowledgeExplorer() {
  const vscode = useVsCodeApi();
  const [activeTab, setActiveTab] = useState<TabType>("facts");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [data, setData] = useState<KnowledgeData>({
    facts: [],
    sessions: [],
    playbooks: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [expandedPlaybooks, setExpandedPlaybooks] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Request initial data
    vscode.postMessage({ type: "getKnowledge" });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "knowledgeData":
          setData(message.data);
          setError(null);
          break;

        case "error":
          setError(message.message);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode]);

  const toggleCategory = (category: string) => {
    const newCategories = new Set(selectedCategories);
    if (newCategories.has(category)) {
      newCategories.delete(category);
    } else {
      newCategories.add(category);
    }
    setSelectedCategories(newCategories);
  };

  const togglePlaybook = (id: string) => {
    const newExpanded = new Set(expandedPlaybooks);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedPlaybooks(newExpanded);
  };

  // Get all unique categories and tags
  const allCategories = useMemo(() => {
    return Array.from(new Set(data.facts.map((f) => f.category)));
  }, [data.facts]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    data.playbooks.forEach((p) => p.tags.forEach((tag) => tags.add(tag)));
    return Array.from(tags);
  }, [data.playbooks]);

  // Filter data based on search and categories
  const filteredFacts = useMemo(() => {
    return data.facts.filter((fact) => {
      const matchesSearch =
        !searchQuery ||
        fact.statement.toLowerCase().includes(searchQuery.toLowerCase()) ||
        fact.source?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        selectedCategories.size === 0 || selectedCategories.has(fact.category);
      return matchesSearch && matchesCategory;
    });
  }, [data.facts, searchQuery, selectedCategories]);

  const filteredSessions = useMemo(() => {
    return data.sessions.filter((session) => {
      return (
        !searchQuery ||
        session.task.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.lessonsLearned?.some((l) => l.toLowerCase().includes(searchQuery.toLowerCase())) ||
        session.agents.some((a) => a.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    });
  }, [data.sessions, searchQuery]);

  const filteredPlaybooks = useMemo(() => {
    return data.playbooks.filter((playbook) => {
      const matchesSearch =
        !searchQuery ||
        playbook.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        playbook.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        playbook.steps.some((step) => step.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesTags =
        selectedCategories.size === 0 ||
        playbook.tags.some((tag) => selectedCategories.has(tag));
      return matchesSearch && matchesTags;
    });
  }, [data.playbooks, searchQuery, selectedCategories]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  return (
    <div className="knowledge-explorer">
      <div className="knowledge-header">
        <h1>Knowledge Explorer</h1>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search knowledge..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "facts" ? "active" : ""}`}
          onClick={() => setActiveTab("facts")}
        >
          Facts ({filteredFacts.length})
        </button>
        {/* Sessions tab hidden until more implemented
        <button
          className={`tab ${activeTab === "sessions" ? "active" : ""}`}
          onClick={() => setActiveTab("sessions")}
        >
          Sessions ({filteredSessions.length})
        </button>
        */}
        <button
          className={`tab ${activeTab === "playbooks" ? "active" : ""}`}
          onClick={() => setActiveTab("playbooks")}
        >
          Playbooks ({filteredPlaybooks.length})
        </button>
      </div>

      {activeTab === "facts" && (
        <div className="filter-section">
          <div className="filter-label">Filter by category:</div>
          <div className="category-filters">
            {allCategories.map((category) => (
              <button
                key={category}
                className={`category-filter ${selectedCategories.has(category) ? "active" : ""}`}
                style={{
                  borderColor: CATEGORY_COLORS[category] ?? "#6B7280",
                  backgroundColor: selectedCategories.has(category)
                    ? (CATEGORY_COLORS[category] ?? "#6B7280") + "30"
                    : "transparent",
                }}
                onClick={() => toggleCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === "playbooks" && allTags.length > 0 && (
        <div className="filter-section">
          <div className="filter-label">Filter by tags:</div>
          <div className="category-filters">
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`category-filter ${selectedCategories.has(tag) ? "active" : ""}`}
                onClick={() => toggleCategory(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="knowledge-content">
        {activeTab === "facts" && (
          <div className="facts-list">
            {filteredFacts.length === 0 ? (
              <div className="empty-state">No facts found</div>
            ) : (
              filteredFacts.map((fact) => (
                <div key={fact.id} className="fact-card">
                  <div className="fact-header">
                    <span
                      className="category-badge"
                      style={{
                        backgroundColor: CATEGORY_COLORS[fact.category] ?? "#6B7280",
                      }}
                    >
                      {fact.category}
                    </span>
                    <span className="confidence-badge" title="Confidence">
                      {Math.round(fact.confidence * 100)}%
                    </span>
                    <span className="timestamp">{formatTimestamp(fact.createdAt)}</span>
                  </div>
                  <div className="fact-statement">{fact.statement}</div>
                  {fact.source && (
                    <div className="fact-footer">
                      <span className="source">Source: {fact.source}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "sessions" && (
          <div className="sessions-list">
            {filteredSessions.length === 0 ? (
              <div className="empty-state">No sessions found</div>
            ) : (
              filteredSessions.map((session) => (
                <div key={session.id} className="session-card">
                  <div className="session-header">
                    <span
                      className="outcome-badge"
                      style={{
                        backgroundColor: OUTCOME_COLORS[session.outcome] ?? "#6B7280",
                      }}
                    >
                      {session.outcome}
                    </span>
                    <span className="timestamp">{formatTimestamp(session.startTime)}</span>
                  </div>
                  <div className="session-task">{session.task}</div>
                  {session.agents.length > 0 && (
                    <div className="session-agents">
                      <span className="agents-label">Agents:</span>
                      {session.agents.map((agent) => (
                        <span key={agent} className="agent-tag">{agent}</span>
                      ))}
                    </div>
                  )}
                  {session.summary && (
                    <div className="session-summary">{session.summary}</div>
                  )}
                  {session.lessonsLearned && session.lessonsLearned.length > 0 && (
                    <div className="session-lessons">
                      <div className="lessons-label">Lessons Learned:</div>
                      <ul className="lessons-list">
                        {session.lessonsLearned.map((lesson, idx) => (
                          <li key={idx}>{lesson}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {session.filesChanged.length > 0 && (
                    <div className="session-files">
                      <span className="files-label">Files changed:</span>
                      <span className="files-count">{session.filesChanged.length}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "playbooks" && (
          <div className="playbooks-list">
            {filteredPlaybooks.length === 0 ? (
              <div className="empty-state">No playbooks found</div>
            ) : (
              filteredPlaybooks.map((playbook) => {
                const isExpanded = expandedPlaybooks.has(playbook.id);
                return (
                  <div key={playbook.id} className="playbook-card">
                    <div
                      className="playbook-header"
                      onClick={() => togglePlaybook(playbook.id)}
                    >
                      <div className="playbook-title-row">
                        <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
                        <h3 className="playbook-title">{playbook.title}</h3>
                        <span className="confidence-badge" title="Confidence">
                          {Math.round(playbook.confidence * 100)}%
                        </span>
                        <span className="use-count" title="Times used">
                          ×{playbook.useCount}
                        </span>
                      </div>
                      <span className="timestamp">{formatTimestamp(playbook.createdAt)}</span>
                    </div>
                    <div className="playbook-description">{playbook.description}</div>
                    {playbook.tags.length > 0 && (
                      <div className="playbook-tags">
                        {playbook.tags.map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {isExpanded && (
                      <div className="playbook-steps">
                        <div className="steps-label">Steps:</div>
                        <ol className="steps-list">
                          {playbook.steps.map((step, idx) => (
                            <li key={idx} className="step-item">
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
