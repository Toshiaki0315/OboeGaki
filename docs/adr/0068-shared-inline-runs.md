# ADR-0068: 行内の装飾は Run に落としてから出力する（Word と PowerPoint で共有）

- 状態: 採用（2026-09-18。全体レビュー 19-5）
- 関連: ADR-0059（Word 書き出し）、ADR-0061（文字色）、TASKS 5-1（スライドの Run）

## 背景

行内の装飾（太字・斜体・打ち消し・コード・リンク・色）を「記号を落として装飾を
残した文字の列」にする処理が 2 か所にあった。`lib/slides.ts` の `runsOf`（Lezer の
木を歩く）と `lib/export-docx.ts` の `runsOf`（markdown-it のトークンを歩き、
自前の style stack で Word の TextRun を直に組む）。同名・同責務で別実装なので、
色 span や強調の扱いを直すたびに 2 か所を直す必要があり、片方だけ直す事故が
構造的に起きる（レビュー 2026-09-18）。

## 決定

**中間の形 `Run`（`src/markdown/runs.ts`）を共有し、出力側はそれだけを見る。**

- `Run = { text, bold?, italic?, strike?, code?, highlight?, link?, color? }`。
  スライドが持っていた形に `highlight` を足した（Word の `==印==`）
- markdown-it 側の変換は `lib/export-runs.inlinePieces(inline)`。run にならない
  もの（強制改行・画像）は別の断片（`break` / `image`）で返し、Word 側が TextRun
  の改行と ImageRun にする
- Lezer 側の変換は `lib/slides.ts` の `runsOf` のまま（`Run` の型と `sameStyle` /
  `plainText` を共有）
- `sameStyle` は「文字以外が全部同じ」の判断を 1 つに（隣どうしを繋ぐとき）

## 解析器は 2 つのまま

HTML / Word は markdown-it、スライドは Lezer で解析している。統一すれば
`runsOf` そのものも 1 つになるが、スライドは見出しの深さでの分割・表のセルの
字面の縦棒・入れ子リストの深さを Lezer の木から取っていて、markdown-it の
トークン列から同じ判断を組み直すのは別の仕事（ADR-0007 の判断にも触れる）。
出力側の重複（Run の後ろ）を先に閉じ、解析の統一は必要が出たときに別の ADR で。

## 却下した案

- **Word も Lezer で解析する**: HTML 書き出しと Word の解析結果が食い違う（今は
  同じ markdown-it から組んでいるのが Word の設計 = ADR-0059）
- **docx の TextRun をスライドでも使う**: pptxgenjs は別の形を要るので、出力の形は
  共有できない。共有できるのは「その手前」だけ
