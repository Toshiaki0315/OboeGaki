import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CaptureRoot } from "./components/CaptureRoot";
import { isCaptureWindow } from "./lib/capture";
// 数式（ADR-0036）。スクリプト体（`\mathscr`）だけは同梱フォントが要る。
// 本体の組版は macOS の数式フォント（STIX Two Math）が担う
import "temml/dist/Temml-Local.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* 書き取りの窓（ADR-0057）は同じ HTML を URL の印で描き分ける */}
    {isCaptureWindow(window.location.search) ? <CaptureRoot /> : <App />}
  </React.StrictMode>,
);
