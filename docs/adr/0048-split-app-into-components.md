# ADR-0048: App.tsx を `src/components/` に切り出す

- **日付**: 2026-09-07
- **状態**: 採用（ソースコードレビュー 2026-09-07 の指摘 ①、ユーザーの
  指示で階層の追加を許可）
- **関連**: CLAUDE.md §5（勝手に階層を増やさない）・T2（文書を React state
  にミラーしない）

## 何を決めたか

`src/App.tsx`（6,020 行、`useState` 75 個）から、**閉じた状態を持つ
ダイアログ**を `src/components/` に切り出す。1 段目は次の 6 つ:

| 部品                   | 中で閉じる状態                                                   |
| ---------------------- | ---------------------------------------------------------------- |
| `PreferencesDialog`    | タブ・キャンセル用スナップショット・使用量とモデル一覧の取り寄せ |
| `GeneralPreferences`   | （表示だけ）                                                     |
| `PptxPreferences`      | 下絵の見本・何枚目・200ms の組み直し待ち・溢れの見直し           |
| `AssistantPreferences` | （表示だけ）                                                     |
| `HistoryDialog`        | （表示だけ）                                                     |
| `SlidePreview`         | （表示だけ。svg）                                                |

**設定そのもの（`settings` / `pptxSettings` / `fontSize`）は App が持ち
続ける**。部品は値を受け取って変更を通知するだけ（`onChangeSettings` など）。
書き戻し・自動保存の取り回し・Tauri の `invoke` も App 側に残し、部品には
`() => Promise<T>` の形で渡す — これで部品は Tauri 無しの jsdom で
テストできる。

## なぜ

- 6,000 行の 1 ファイルは、ダイアログの 1 行を直すにも全体を開く必要があり、
  差分レビューが利かない
- App の state が 1 つ変わる（打鍵ごとの `cursorPos` / `stats` を含む）
  たびに、開いてもいないダイアログの JSX まで再評価されていた
- ダイアログ単体の React テストが書けなかった。切り出した部品には
  Testing Library で振る舞いのテストを付けた（`src/components/*.test.tsx`）

## 持ち込んだもの

- `jsdom` / `@testing-library/react`（devDependencies）。テストファイルの
  先頭に `// @vitest-environment jsdom` を書いたものだけが DOM で走り、
  既存の Lezer / lib のテストは Node のまま
- `PreferencesDialog` と `HistoryDialog` の外枠に `role="dialog"` を付けた
  （テストの足場であり、読み上げにも効く）

## 挙動の差（意図したもの）

- PowerPoint タブの下絵の状態（どの見本・何枚目）は、**タブを離れると
  既定に戻る**。以前はダイアログを閉じても残っていた。見本の選択は
  一時的なもので、覚える価値が無い
- `PreferencesDialog` は開いている間だけ mount されるので、キャンセル用の
  スナップショットは「初回描画の props」で足りる（`useRef` の初期値）

## 進み具合（2026-09-07 時点）

同日のうちに 20 段まで進めた。App.tsx は 6,020 行 → 3,706 行、`useState`
は 75 → 60 個。切り出した部品（`src/components/`、各 1 コミット）:

- 窓: PreferencesDialog（General / Pptx / Assistant の 3 タブ）・
  HistoryDialog・PromptDialog（名前を 1 つ聞く 4 つの窓を束ねた）・
  ChoiceDialog（選択肢だけの 3 つの窓を束ねた）・TableDialog・
  GraphDialog・StyleCheckDialog
- パレット: FuzzyPalette（クイックオープン・見出し）・ListPalette
  （テンプレート・フォルダへ移動）
- 枠と絵: ContextMenu / SubMenu・MenuIcon / PathIcon・SlidePreview
- エディタまわり: FormatToolbar・NoteActions・BacklinkBar・OutlinePane・
  StatusBar・AssistantPane
- サイドバーの葉: SearchHits・TagSection・SavedSearchSection・NoteRows・
  TrashRows

`noteStem` / `noteLabel` は `src/lib/note-path.ts` に移した。

## 次の段

残っているのは、App の状態と深く結びついているもの:

- **フォルダの節**（サイドバー）。ドラッグ＆ドロップの受け口と落とし先の
  強調（`dropFolder` / `dropTrash`）が App の ref・state に跨る。切るなら
  props が 15 前後になるので、強調の状態を節の中に閉じる設計から考える
- **右クリックメニューの中身**（ノート・本文・歯車・タグ・フォルダ・
  ゴミ箱・アウトラインの 7 つ）。枠は部品にしたが、項目の並びは App の
  振る舞いそのものなので、切るなら「項目の並び」を配列で渡す形
- 題名の欄（改名）と `<main>` の外枠（D&D の受けるふり）

同じ手順（RED → GREEN → `make check` → 1 部品 1 コミット）で進める。
