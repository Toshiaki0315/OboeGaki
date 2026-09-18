// Tauri コマンドの薄い包み。**ここは Rust を呼ぶだけ**で、状態は持たない
// （状態は stores/app のストアと、文書については EditorView）。Rust 側の
// 形（snake_case・タプル）を画面側の形（camelCase・オブジェクト）に直す
// のもここ。
//
// 20-5: 領域ごとに ipc-*.ts へ分けた（live-preview と同じ接頭辞方式。階層は増やさない）。
// import 先はこのまま `lib/ipc`。`@tauri-apps/*` を読むのは ipc-*.ts だけ（eslint が見張る）。

export * from "./ipc-notes";
export * from "./ipc-history";
export * from "./ipc-assets";
export * from "./ipc-llm";
export * from "./ipc-text";
export * from "./ipc-app";
export * from "./ipc-os";
