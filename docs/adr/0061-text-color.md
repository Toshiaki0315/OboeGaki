# ADR-0061: 本文の文字色 — `<span style="color: …">` を限定的に受ける

- 状態: 採用（実装は TASKS 12-11）
- 日付: 2026-09-11

## 背景

Markdown には文字色の記法が無い。NotePM は `<span style="color: red;">…</span>`
を挿すボタンでこれを補っている（ユーザー提示 2026-09-11、notepm.jp/blog/375）。
Qiita・Obsidian・NotePM など多くの道具がこの書き方を描くので、**ファイルの
可搬性を保ったまま色を付けられる**。おぼえがきには `::目立つ::` のマーカー
（1 色）しか無い。

一方、HTML 書き出しは生の HTML を通さない（markdown-it `html: false`）。
`<br>`（表のセル内改行 = ADR-0028）と `<details>`（Qiita の折りたたみ =
TASKS 6-2）だけを**形を見て**通している。任意のタグを素通りさせると、貼り
付けた本文の中のタグがそのまま出る。この方針は保つ。

## 決定

### 1. 記法と受け入れ範囲

- 受けるのは `<span style="…">…</span>` だけ（`<font color>` は受けない。
  HTML5 で廃止された記法を新しく書かせない）
- `style` に許すのは **`color` と `background-color` の 2 属性**。値は CSS の
  色名か `#` 付き 3/6 桁の 16 進だけ。それ以外の属性・値（`url()`・`expression`
  ・`!important`・他のプロパティ）が 1 つでもあれば、その span は**色として
  扱わず素の文字のまま**（壊さない・通さない）
- 判定は純関数 `lib/text-color.ts`（`parseColorSpan(style) -> {color?, background?} | null`）
  に一本化し、エディタ・HTML 書き出し・PowerPoint が同じものを使う

### 2. エディタ

- カーソルが離れているとき、開き・閉じのタグを隠し（`Decoration.replace`。
  T1: 文書は変えない）、中の文字に mark で色を付ける。触れているときは生の
  タグを見せる（他のインライン記法と同じリビール規則）
- 中の太字・リンク・コードはそのまま効く（Lezer は HTMLTag をインラインの
  ノードとして置き、中身は Markdown として解析を続ける）
- 色は**パレットに写す**。`red` などの色名と 16 進は CSS 変数
  （`--text-red` …）に近いものへ丸めず、そのまま描く — ただし**ダークテーマ
  では明度を上げて読めるようにする**（`color-mix` で白を混ぜる）。ファイル
  の値は変えない

### 3. ツールバー

- 「文字色」ボタン。押すと 6 色（赤・橙・黄・緑・青・紫）+「色を消す」の
  小さなパレット。選択範囲を `<span style="color: #RRGGBB">…</span>` で包む。
  値は 16 進で書く（色名は道具ごとに色が違う）。背景色のボタンは作らない
  （マーカー `::…::` がある）
- 「色を消す」は選択範囲を包む span を外す（属性が color だけのとき。他の
  属性が混じっていれば触らない）

### 4. 書き出し

- HTML: `detailsHtmlRule` と同じ「形を見て通す」規則に、`parseColorSpan` が
  受けた span だけを足す。出す HTML は**こちらで組み直す**
  （`<span style="color:#RRGGBB">`）。書いた属性を素通りさせない
- PowerPoint: `Run` に `color` を足し、run 単位で色を置く（pptxgenjs は
  `color: "RRGGBB"`）。背景色は置かない（PowerPoint の run にハイライトは
  あるが、スライドでは読みにくい）
- 印刷・PDF は HTML の経路

## 根拠

| 案  | 内容                                       | 問題                                   |
| --- | ------------------------------------------ | -------------------------------------- |
| A   | `::赤::文字::` のような独自記法            | 他の道具で描けない。可搬性を失う       |
| B   | **`<span style>` を 2 属性に限って受ける** | 記法が長い（ツールバーで補う）         |
| C   | `html: true` にして全部通す                | 貼り付けた本文の任意のタグが素通りする |

B。記事の方式そのままで、他の道具との往復が壊れない。

## 影響

- `extended-inline.ts` は触らない（HTMLTag は Lezer が既に切る）。装飾は
  `live-preview.ts`、判定は `lib/text-color.ts`
- CSP は変えない（画面の装飾は mark の style 属性で付けるが、CSP の
  `style-src 'unsafe-inline'` は既に許している）
- docs/manual_test.md に「色を付ける・消す・ダークで読める・HTML と
  PowerPoint に出る」を足す
