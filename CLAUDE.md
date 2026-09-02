# CLAUDE.md — 覚書（OboeGaki）Tauri 版 開発ガイド

ライブプレビュー型 Markdown エディタ **覚書（OboeGaki）** の再実装
（macOS 13+ / Tauri v2 / React 19 / TypeScript / CodeMirror 6）。
表示名は「覚書」、ファイル名・フォルダ名・ID 系は「OboeGaki」（ADR-0032）。

**参照実装（PySide6 版）が `~/01_projects/hitofude` にあり、凍結維持している。**
仕様の真実は [docs/spec.md](docs/spec.md)（参照実装から持ち込んだもの。
Qt 前提の節は読み替えが要る — §「spec の読み方」参照）。
移行の技術検証の記録は [spikes/](spikes/) にある。

---

## 1. 開発プロセス（TDD 必須）

**このプロジェクトはテスト駆動開発で進める。例外はない。**

1. **RED** — 先にテストを書き、実行して**失敗することを確認する**
2. **GREEN** — テストを通す最小限の実装を書く
3. **REFACTOR** — テストが緑のまま整理する
4. **VERIFY** — `make check` が緑
5. **COMMIT** — ここで初めてコミットする

### コミット前チェックリスト（絶対）

```bash
make check
```

- [ ] vitest が全件緑
- [ ] `tsc --noEmit` が緑
- [ ] `cargo test` / `cargo clippy` / `cargo fmt --check` が緑
- [ ] 実装だけ、またはテストだけのコミットになっていない

**テストが赤い状態でコミットしてはいけない。** `skip` での回避も禁止。
コミットは `make check` の**終了コードで**ゲートする（`;` で繋がない —
過去に赤コミットを 2 回踏んでいる）。

### テストの書き方

- 1 テスト = 1 振る舞い。テスト名は日本語可
  （Rust も `fn test_テスト基盤が動く()` のように書ける）
- **バグを直すときは、先にそのバグを再現する回帰テストを書く**
- パーサ・エディタ拡張の正しさは**参照実装をオラクル**にする:
  hitofude の `core/inline_scanner.py` `scan()` の出力と突き合わせる
  （`src/editor/relaxed-emphasis.test.ts` が手本。オラクルの生成手順は
  `spikes/01-flanking/`）
- **打鍵レベルの日本語 IME は自動テストで再現できない**（Qt でも Web でも
  同じ）。IME 周りは手動チェックリスト（docs/manual_test.md）で担保する
- **オフセットの単位差に注意**: JS/CM6 は UTF-16 コード単位、Python
  オラクルはコードポイント。BMP 内の日本語は一致するが、絵文字を含む
  ケースでは変換を挟む

---

## 2. コマンド

| 目的 | コマンド |
|---|---|
| 初回セットアップ | `make setup` |
| アプリ起動（WKWebView） | `make run`（= `npm run tauri dev`。初回は Rust ビルドで数分） |
| フロントのテスト | `make test`（= `vitest run`） |
| Rust のテスト | `make test-rust` |
| コミット前チェック | `make check` |
| フォーマット | `make fmt` |
| 依存追加（TS） | `npm install <pkg>` / `npm install -D <pkg>` |
| 依存追加（Rust） | `cd src-tauri && cargo add <crate>` |

`package-lock.json` / `Cargo.lock` は必ずコミットする（再現性）。

---

## 3. アーキテクチャの不可侵ルール

参照実装で実測・スパイクで検証済みの結論。**破ると設計が崩壊する**ので、
変更したくなったら実装前に必ず相談すること。hitofude の R1〜R9 との対応を
併記する。旧ルールのうち R2/R4/R5/R7（Qt の欠陥への防御）は、CM6 では
**構造的に成立するため規約としては消滅**した（spikes/02 で検証済み）。

### T1. ソース文字列が唯一の真実（旧 R1）

CM6 の `EditorState.doc` がそのまま保存内容。往復変換を挟まない。
装飾（decoration）は文書を 1 文字も変更しない別レイヤであること
（`Decoration.replace` で隠す。文字の削除・置換は禁止）。

### T2. 文書を React state / Zustand にミラーしない

エディタ状態（文書・選択・Undo）は `EditorView` だけが持つ。React は
mount/unmount のみ（`src/editor/Editor.tsx`）。キーストロークごとに React が
再レンダリングする設計は性能基準 16ms を壊す。Zustand の守備範囲は
タブ・ペイン・検索結果などのアプリ状態まで。

### T3. Rust 側（vault・保存・索引・監視）は WebView 非依存（旧 R3）

`src-tauri/` の永続化ロジックは Tauri commands の薄い層を除いて
純 Rust で書き、`cargo test` でヘッドレステストする。
TS 側のパーサ拡張も DOM 非依存（Lezer 単体でテストできる形）に保つ。

### T4. `*` の flanking 緩和は relaxed-emphasis.ts に集約（旧 R4 の翻訳）

規則:「開き = 直後が空白でない / 閉じ = 直前が空白でない」。
`_` は CommonMark 厳密のまま（snake_case を守る）。デリミタ列は
長さ完全一致（1/2/3）でのみ対にする。参照実装との等価性は
オラクルテストが守っている — 挙動を変えるならオラクルの再生成から。

### T5. IME ガード（旧 R6）

CM6 は composition 中の DOM 更新を保留する。この性質を壊す拡張
（composition 中に `dispatch` する入力補助など）を書かないこと。
入力補助を追加するときは必ず IME 手動チェック（docs/manual_test.md の
3 項目）を通してから完了とする。

### T6. 装飾の再計算は可視範囲だけ（旧 R7 の翻訳）

`ViewPlugin` の decoration 構築は `view.visibleRanges` の走査に限る。
文書全体を走査する装飾・全体再パースを自分で書かない
（インクリメンタル解析は Lezer が担う。信じて任せる）。

### T7. `.OboeGaki/index.sqlite` は捨ててよいキャッシュ（旧 R9）

削除しても `.md` から完全再構築できること。真実は常にファイル側。
**捨ててよいのは索引だけ**（ADR-0023）。`.OboeGaki/history/` の版は
作り直せない。旧 `.hitofude` は開くときに一度だけ改名して引き継ぐ
（参照実装 `vault.migrate_managed_dir` と同じ挙動を Rust で再現する）。

---

## 4. spec の読み方

[docs/spec.md](docs/spec.md) は PySide6 前提で書かれている。設計の**意図**
（何をどう見せるか・性能基準・日本語対応の要件）は全て有効だが、
**実現手段**の節は読み替える:

| spec の節 | 扱い |
|---|---|
| §3.3（0.5pt 隠蔽・QTextDocument 禁止） | 手段は無効。意図は T1 が引き継ぐ |
| §6.4（2 ブロック再ハイライト） | 手段は無効。意図は T6 が引き継ぐ |
| §3.4 / §6.5（インラインスキャナ仕様） | 検出**規則**は有効（T4 の根拠）。マスク方式という実装は Lezer 拡張に置き換え |
| §5.5（IME）・§6.6（性能基準）・§7（vault/索引） | そのまま有効 |
| docs/adr/ | 0002・0007 など Qt 固有のものは前提ごと消滅。参照時に注意 |

spec と実装が食い違ったら、まず spec（の意図）が正しいと考える。
覆すなら理由を述べて確認を取り、`docs/adr/` に記録を残す（番号は
hitofude から通しで継続。次は 0034）。

---

## 5. ディレクトリ構成

```
OboeGaki/
├── CLAUDE.md              # このファイル
├── Makefile               # 開発コマンドの入口
├── docs/                  # spec・ADR・手動チェックリスト（hitofude 由来）
├── fixtures/              # 挙動検証用 .md と golden（スタック非依存の仕様資産）
├── spikes/                # 移行時の技術検証の記録（触らない・消さない）
├── src/                   # フロントエンド（React + TS）
│   ├── editor/            # CM6 エディタ層（拡張は DOM 非依存に保つ）
│   └── ...                # アプリ UI 層（Zustand / dnd-kit はここ）
└── src-tauri/             # Rust 側（vault・保存・索引・監視 = 旧 core/ + storage/）
    └── src/
```

**勝手に階層を増やさない。** 新しい層が要るときは理由を述べて相談。

---

## 6. コーディング規約

- TypeScript: `strict`。`any` を書かない。公開関数に型注釈
- Rust: `cargo fmt` / `cargo clippy` を緑に保つ。`unwrap()` は
  テストと初期化以外で使わない
- コメントは「なぜ」を書く。「何を」はコードで表現する
- コミットは Conventional Commits + 日本語本文（hitofude と同じ）。
  type: feat/fix/test/refactor/docs/chore/perf/build、
  scope: editor/ui/tauri/build/docs。テストと実装は同じコミットに含める

---

## 7. パフォーマンス受け入れ基準（spec §6.6 のまま）

| 指標 | 基準 |
|---|---|
| キー入力 → 画面反映 | 95 パーセンタイル < 16ms（10,000 語のノート） |
| 全文検索 | < 200ms（5,000 ノートの vault） |
| 起動 → ウィンドウ表示 | < 1.5 秒（Apple Silicon） |

検証していない性能・挙動を「できました」と報告しない。実測値か
テスト結果を添える。
