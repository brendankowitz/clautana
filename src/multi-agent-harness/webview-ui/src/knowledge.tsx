import React from "react";
import ReactDOM from "react-dom/client";
import { KnowledgeExplorer } from "./components/KnowledgeExplorer";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KnowledgeExplorer />
  </React.StrictMode>
);
