import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentView } from './components/AgentView';
import './styles/index.css';
import './styles/agent-view.css';
// Global types from globals.d.ts

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgentView
      agentName={window.agentName ?? 'orchestrator'}
      isOrchestrator={window.isOrchestrator ?? true}
    />
  </React.StrictMode>
);
