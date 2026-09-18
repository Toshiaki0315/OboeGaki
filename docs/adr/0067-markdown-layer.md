# ADR-0067: `src/markdown/` — Markdown 方言の純粋な知識を 1 つの層に

- 状態: 採用（2026-09-18。全体レビューの判断 3）
- 関連: CLAUDE.md T3（TS の拡張は DOM 非依存）、§5（階層を増やすときは相談）、
  17-8（TS と Rust の共有の見本）

## 背景

「この文字列は front matter か」「`![alt|300]` の幅はいくつか」「`$…$` は数式か」
「`- [ ]` はやることか」といった **Markdown 方言の知識**が、`src/editor/`（CM6 の
拡張と同居）と `src/lib/`（60 ファイル超の置き場）に散っていた。書き出し
（HTML / Word / スライド）はその知識を使うので、`lib → editor` の import が
15 本あり、`editor → lib` も 7 本あって、依存が双方向になっていた。

Rust と共有する見本（`fixtures/*-cases.json`: front matter・やること・タグ・節・
ファイル名）の TS 側の実装も、この知識にあたる。置き場が 1 つでないと
「Rust と揃えるべきもの」が一覧できない。

## 決定

**`src/markdown/` を新設し、CM6 に依存しない構文の知識をここに集める。**
依存の向きは `editor → markdown ← lib`。

| 置いたもの | 元 |
| --- | --- |
| `front-matter.ts`（範囲・本文・`key: 値`） | editor/frontmatter.ts の純粋部（隠蔽の field は editor に残る） |
| `image-size.ts`（`alt|幅` の分け方） | editor/image-size.ts |
| `math-span.ts`（`$…$` の範囲。組版 `renderMath` は editor/math.ts に残る） | editor/math.ts |
| `fence-info.ts`（` ```lang:file ` の分け方。言語解決は editor に残る） | editor/code-blocks.ts |
| `tasks.ts` / `tag-name.ts` / `section.ts` | lib/ |
| `syntax.ts`（リスト・やること・見出しの正規表現。3 ファイル 9 定義を 1 か所に） | editor/input-assist・format-commands・lib/tasks |

規則は eslint（`no-restricted-imports`）で守る: `markdown/` は `@codemirror/*`
`@lezer/*` `react` `@tauri-apps/*` と他の層（editor / lib / components / hooks /
stores）を読まない。

## 残したもの（意図）

- Lezer のパーサ拡張（`relaxed-emphasis.ts` `extended-inline.ts`）は方言そのものだが
  `@lezer/markdown` に依存するので editor に残す。`lib/slides.ts` がこれを読むのは
  例外として認める（Lezer で解析するのが slides だけ）
- `note-container.ts` `details-container.ts` は CM6 の `Text` 型で行を読むので editor
  に残す。書き出しが読む 2 本の `lib → editor` は残る
- `syntax.ts` の正規表現は**字面を変えずに移した**。同じ形に見えて意図して違う
  3 つ（`BULLET_TASK_RE` は点だけ・`LIST_TASK_RE` は番号も・`TASK_LINE_RE` は空白
  ちょうど 1 つ）は名前とコメントで区別する。揃えるなら別の ADR

## 却下した案

- **lib に降ろす**: 階層は増えないが、lib は雑多な置き場で方言の核が埋もれる
- **editor に残して lib → editor を許す**: 「editor は CM6 の層」という説明が崩れ、
  DOM を触るファイルまで lib から届く
