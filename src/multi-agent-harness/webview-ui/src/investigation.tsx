import React from "react";
import ReactDOM from "react-dom/client";
import { InvestigationBrowser } from "./components/InvestigationBrowser";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <InvestigationBrowser />
  </React.StrictMode>
);
