# スパイク #3: IME 変換中の装飾更新 — 結果: **GO**（手動確認）

打鍵レベルの日本語 IME は自動テストで再現できない（Qt でも Web でも同じ。
hitofude docs/manual_test.md と同じ制約）ため、スパイク #2 の環境で
人手により確認した。

## 確認結果（2026-09-02、macOS 日本語 IME / Chromium 系ブラウザ）

| 項目 | 結果 |
|---|---|
| 1. 変換中（プリエディット下線の表示中）に表示が乱れない | ✅ |
| 2. 変換確定後、`**` で囲んだテキストが正しく強調になる | ✅ |
| 3. 強調の中にカーソルを置いて変換入力しても壊れない | ✅ |

CM6 は composition 中の DOM 更新を保留する設計（hitofude の R6 で
自前実装していたガードに相当）で、それが実際に日本語 IME で機能した。

## 残る確認事項

この確認は Chromium（Claude Code の Browser pane）上のもの。
**Tauri の macOS 実行環境は WKWebView（Safari 系）**なので、Tauri の
足場ができた時点で同じ 3 項目を WKWebView 上でも通すこと。
composition イベントの細部は WebKit と Blink で差があり得る。
確認したら結果をここに追記する。
