# 覚書（OboeGaki）— Tauri 版

ライブプレビュー型 Markdown エディタ **覚書** の Tauri v2 + React + TypeScript
による再実装。参照実装（PySide6 版）は `~/01_projects/hitofude` にあり、
機能同等になるまで凍結維持する。

予定スタック: Tauri v2（Rust）/ React 19 / TypeScript / Vite /
CodeMirror 6（編集コア）/ Lezer（パーサ）/ Zustand / dnd-kit

## 持ち込んだ資産（PySide6 版からコピー）

| パス | 中身 | 注意 |
|---|---|---|
| `docs/spec.md` | 仕様書。設計判断の根拠はすべてここ | §3.3, §6.4 など Qt 前提の節は CM6 では前提が変わる。書き直すまで「意図」だけ読む |
| `docs/adr/` | 設計決定の記録 | 0002（QTextBlockFormat）・0007（setMarkdown）など Qt 固有の ADR は本実装では前提ごと消滅。参照時に要注意 |
| `docs/IDEAS.md` | やると決めていないもの | そのまま有効 |
| `docs/manual_test.md` | 人にしかできない手動チェック（IME まわり等） | IME 打鍵の自動テスト不能は Web でも同じ。そのまま有効 |
| `docs/ollama.md` | ローカル LLM（Ollama）の準備手順 | スタック非依存 |
| `fixtures/*.md` | 振る舞い検証用の入力（basic / japanese / edge_cases / large） | スタック非依存の仕様資産 |
| `fixtures/golden/*.json` | 各 fixture の期待ハイライト結果（行ごとの block 種別と range） | range のオフセットと分類は新スキャナの検証にそのまま使える。書式ラベル（`hidden:0.5` 等）は Qt 実装の表現なので読み替える |

## 最初のマイルストーン

リポジトリ整備より先に、技術的な山場のスパイクを通す:

1. **日本語 flanking** — `日本語の**強調**` を CommonMark の flanking 規則を
   緩めて検出できるか（Lezer の markdown パーサ拡張で解けるか）。
   参照: spec §6.5、`fixtures/golden/japanese.json`
2. マーカー隠蔽 — `Decoration.replace` でカーソル近傍だけソースを見せる
   Obsidian 型ライブプレビューの最小実装
3. IME — 変換中に装飾更新が確定文字列を壊さないこと（手動確認）

ここが通らなければ移行計画自体を見直す。
