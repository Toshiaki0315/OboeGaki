import { Editor } from "./editor/Editor";
import japanese from "../fixtures/japanese.md?raw";
import "./App.css";

// 足場フェーズ: fixtures の日本語ノートを開いた状態で起動し、
// WKWebView 上でライブプレビューと IME を確認できるようにする。
// vault のオープン・保存は次フェーズで Rust 側（Tauri commands）に載せる。

function App() {
  return (
    <main className="app">
      <Editor initialDoc={japanese} />
    </main>
  );
}

export default App;
