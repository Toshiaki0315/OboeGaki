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

## 最初のマイルストーン: スパイク 3 本 — **全部 GO**（2026-09-02）

移行判断のゲートだった技術検証は完了。詳細は各 `spikes/*/README.md`。

1. ✅ **日本語 flanking**（`spikes/01-flanking/`）— Lezer 拡張 30 行で解決。
   参照実装オラクルと fixtures 段落 113/113 一致
2. ✅ **マーカー隠蔽**（`spikes/02-marker-hiding/`）— `Decoration.replace` で
   R1/R4/R5 相当が構造的に成立。Undo 1 段も確認
3. ✅ **IME**（`spikes/03-ime/`）— 手動確認 3 項目パス。
   WKWebView（Tauri 実機ウィンドウ）でも再確認済み

## 第 2 マイルストーン: Tauri の足場 — **完了**（2026-09-02）

- ✅ `create-tauri-app`（React + TS + Vite）の骨格。命名は ADR-0032 準拠
- ✅ スパイク成果を `src/editor/` に TS 移植（flanking 緩和・マーカー隠蔽・
  React ラッパ。文書を React state / Zustand にミラーしない）
- ✅ テスト基盤: vitest（参照実装オラクル等価性 16 件）+ cargo test +
  `make check`
- ✅ WKWebView 上で IME 3 項目パス

## 次のマイルストーン

- ✅ 開発規約の整備（2026-09-02）: CLAUDE.md（TDD サイクル・不可侵ルール
  T1〜T7）と CI（GitHub Actions / macos-14 で make check と同内容）
- ✅ spec の新スタック対応（2026-09-02）: ADR-0034 + §3.3・§6.1・§6.4 差し替え、
  §3.4・§4・§6.3 に読み替え注記
- ✅ Phase 1 の骨格（2026-09-02）: vault のオープン・走査・改名引き継ぎ・
  アトミック書き込み（Rust、TDD）+ フォルダを開く→一覧→編集→800ms
  自動保存の最小 UI。実機で 3 項目確認済み
- Phase 1 の残り: ノートの新規作成・改名・ゴミ箱、外部変更の検知
  （notify）、SQLite FTS5 索引（§7.3）
