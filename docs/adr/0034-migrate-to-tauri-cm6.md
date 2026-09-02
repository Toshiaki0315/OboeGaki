# ADR-0034: 実装基盤を Tauri v2 + CodeMirror 6 に移行する

- **日付**: 2026-09-02
- **状態**: 採用
- **覆す対象**: spec.md §3.3・§3.4・§4・§6.1・§6.3・§6.4 の**実現手段**
  （挙動仕様・日本語対応の要件・性能基準・vault/索引の設計は維持する）

## 背景

覚書を Tauri v2 + React + TypeScript のスタックで再実装するというユーザー
決定（2026-09-02）。PySide6 版（hitofude）は Phase 0〜5 完了・既知バグゼロの
状態で凍結し、**参照実装**として挙動の正解を提供し続ける。

spec.md の設計判断のうち、Qt の欠陥への防御として置かれていたもの
（setMarkdown 禁止・0.5pt 隠蔽・QTextBlockFormat 禁止・2 ブロック再
ハイライト）は、CM6 では前提となる欠陥自体が存在しないため意味を失う。
一方で「何をどう見せるか」「日本語で困らないこと」「性能基準」は
スタックに依存しない仕様として全て引き継ぐ。

## 決定

技術選定を次のとおり置き換える（spec §4 の表に対応）:

| 領域 | 旧（hitofude） | 新（OboeGaki） |
|---|---|---|
| 言語 | Python 3.12+ | TypeScript（フロント）+ Rust（永続化） |
| GUI 基盤 | PySide6 / `QPlainTextEdit` | Tauri v2（WKWebView）+ React 19 + Vite |
| 編集コア | `QSyntaxHighlighter` 自作 | **CodeMirror 6** |
| ブロック解析 | markdown-it-py | **@lezer/markdown**（インラインと統合） |
| インライン解析 | 自作 `re` スキャナ | 同上 + `relaxed-emphasis.ts` 拡張 |
| アプリ状態 | 自作 + QSettings | Zustand（文書はミラーしない = T2） |
| 検索インデックス | sqlite3 + FTS5 trigram | rusqlite + FTS5 trigram〔予定〕 |
| ファイル監視 | watchdog | notify crate〔予定〕 |
| パッケージング | py2app | Tauri bundler |
| テスト | pytest + pytest-qt | vitest + cargo test |
| Lint / Format | ruff | prettier + tsc + clippy + rustfmt |

不可侵ルールは CLAUDE.md の T1〜T7 に再編した（旧 R1〜R9 との対応も
そこに記載）。旧 R2/R4/R5/R7 は CM6 では構造的に成立するため規約として消滅。

## 根拠

移行判断のゲートとして行ったスパイク 3 本（`spikes/`、いずれも 2026-09-02 実測）:

1. **日本語 flanking**（spikes/01）: `*` の緩和を Lezer の公開拡張 API 約 30 行で
   実現。参照実装 `inline_scanner.scan()` をオラクルに、厳選 15 ケースで
   15/15、fixtures 段落全 113 行で 113/113 一致
2. **マーカー隠蔽**（spikes/02）: `Decoration.replace` でソース無傷・位置 1:1・
   Undo 1 段（装飾再計算を挟んでも）をブラウザ実測で確認
3. **IME**（spikes/03）: 変換中の表示・確定後の強調化・強調内での変換入力の
   3 項目を、Chromium と WKWebView（Tauri 実機ウィンドウ）の両方で手動確認

および、同モデル（WebView + CM6 ライブプレビュー）の大規模実運用例として
Obsidian が存在すること。
