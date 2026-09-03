import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// 数式（ADR-0036）。スクリプト体（`\mathscr`）だけは同梱フォントが要る。
// 本体の組版は macOS の数式フォント（STIX Two Math）が担う
import "temml/dist/Temml-Local.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
