# スパイク #2: Decoration.replace によるマーカー隠蔽 — 結果: **GO**

Obsidian 型ライブプレビュー（マーカーを隠し、カーソルが触れている範囲だけ
ソースを見せる）を CM6 の decoration だけで実現できるかの検証。
hitofude の R1（ソースが唯一の真実）・R4（位置 1:1）・R5（Undo 1 段）に
相当する性質が CM6 で成り立つかを確かめた。

## 結果（2026-09-02、Vite dev サーバー + Browser pane で実測）

| 検証 | 結果 |
|---|---|
| ソース文字列は無傷のまま表示から `**`・`# ` が消える | ✅ `doc.toString()` に全マーカー残存、`contentDOM.textContent` から消滅 |
| カーソルが範囲に触れるとソースが現れ、離れると隠れる | ✅ |
| **Undo 1 回で直前の入力に戻る**（間にカーソル移動 4 回 = 装飾再計算を挟んでも） | ✅ 装飾は Undo スタックに乗らない |
| 隠蔽中も `coordsAtPos` 等の位置 API が破綻しない | ✅ |
| スパイク #1 の flanking 緩和が `markdown({extensions})` 経由で効く | ✅ `カギ括弧**「テスト」**` の `**` が隠れる = 強調として解析されている |

## 実現方法（main.mjs、約 60 行）

- `ViewPlugin` + `RangeSetBuilder` で、可視範囲の構文木から
  `EmphasisMark` / `HeaderMark` を拾い `Decoration.replace({})` を張る
- 親ノード（`Emphasis` / `ATXHeading1` など）の範囲に選択が触れている
  （端を含む）間はその親のマーカーを張らない = ソース表示
- 再計算は `docChanged || selectionSet || viewportChanged` のときだけ。
  文書は一切変更しないので、位置マッピングも Undo 対策も**そもそも不要**

hitofude で規約として守っていた R4(0.5pt 隠蔽)・R5(QTextBlockFormat 禁止)は、
CM6 では「装飾が文書と別レイヤ」という構造で自動的に保証されることを確認。

## 製品実装への持ち越し事項

- 再計算の粒度: このスパイクは毎回全可視範囲を作り直す。実測で問題が出たら
  `RangeSet.update` による差分更新に切り替える（R7 相当の最適化）
- 「触れている」の定義: 端を含む overlap にした。行単位で見せる
  （Obsidian の挙動に近い）かはデザイン判断
- IME 変換中の装飾更新はスパイク #3 で検証する（CM6 は composition 中の
  DOM 更新を保留する設計だが、実際に日本語 IME で確かめる）
