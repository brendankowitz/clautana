import React from "react";
import ReactDOM from "react-dom/client";
import { KanbanBoard } from "./components/KanbanBoard";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KanbanBoard />
  </React.StrictMode>
);
