# コードレビュー 2026-09-04

対象: main（f98a8cb）。Rust 層・エディタ層・アプリ層を全ファイル精査し、
重要な指摘は実測・実証で裏を取った。`make check` は緑（vitest 440 / cargo 222）。

「実証済み」= このレビューで実際に再現・計測したもの。

---

## 高（データ消失・クラッシュ・性能基準割れ）

- ✅ 対応済み（同日 75f7659） **[実証済み] 打鍵性能が基準割れ**（p95 = 17〜25ms、基準 16ms。2 回計測とも不合格）。
  原因は複合:
  - `live-preview.ts` tableField: 「解析が進んだ」を**構文木のオブジェクト同一性**
    （`syntaxTree(tr.state) !== syntaxTree(tr.startState)`）で判定しており、
    カーソル移動だけの transaction でも表の全再計算が走る（2cd93f5 の退行）
  - `blockWidgetField`（数式・図・:::note）は**毎打鍵・毎カーソル移動で全再計算**。
    その中の `noteContainers(doc)` は :::note が無くても**全行走査**、
    数式は**文書全体の全ブロックを毎回 Temml で組み直す**（T6 の意図に反する）
  - 対処案: 「解析の進み」は `syntaxTree(state).length` の伸びで判定する。
    blockWidgetField にも tableField 同等の間引き（ゾーン + 位置写像）を入れる
- ✅ 対応済み（同日） **[実証済み] 閉じの無い `$$` が後続文書の構文解析を丸ごと捨てる**
  （`extended-inline.ts:100` MathBlock）。`@lezer/markdown` の BlockParser 契約では
  `false` を返すとき `nextLine()` で進んではいけないが、文書末まで進めてから
  `false` を返している。`$$` を打った瞬間、それ以降の見出し・装飾・折りたたみ・
  アウトラインが全部消える（数式を書いている間は常時この状態）。
  開き判定 `slice(line.pos)` と閉じ判定 `line.text` の基準ずれ（引用内で不一致）も同居
- ✅ 対応済み（同日） **[実証済み] `percent_decode` がマルチバイト境界でパニック**（`references.rs:49`）。
  `%` の直後に日本語が来る本文（`![](attachments/%あ.png)` 等）が vault の
  どこかに 1 つあるだけで「使っていない添付を片づける」が必ず落ちる。
  境界チェックはバイト長なのにスライスは `&str` のバイト添字
- ✅ 対応済み（同日） **`autosave.flush()` が同期・保存は非同期、なのに全域が「flush してから次へ」前提**
  （`debounce.ts:37` + App.tsx 14 箇所）。個別の実害:
  - ピン留め: `note_pin` がディスクを読み直して古い本文で保存 + エディタ上書き →
    **直前の編集が Undo も効かず消える**（App.tsx:1171）
  - 改名・フォルダ移動: 旧パスへの保存が後着し**旧ノートが復活**（同内容が 2 つに）
  - 添付の掃除: 貼ったばかりの画像が「未使用」扱いでゴミ箱行き
  - 書き出し・印刷・履歴一覧: 保存前の古い本文を読む
  - 対処案: `flush()` を Promise を返す形にして呼び出し側で await（1 修正で全部消える）
- ✅ 対応済み（同日） **競合ダイアログ表示中も自動保存の予約が生きている**（App.tsx:1644 の分岐だけ
  `autosave.cancel()` が無い）→ ユーザーが答える前に自分の版で外部変更を上書き。
  「外部の変更を採用」後もディスクは自分の版のまま（画面と食い違い）。
  さらに「自分の版で上書き」は `flush()` 頼みなので予約が無いと **no-op なのに
  成功メッセージが出る**（App.tsx:1723 — `pendingSave.current?.()` を直接呼ぶべき）
- ✅ 対応済み（同日） **`pendingSave` の完了処理がノートを取り違える**（App.tsx:1364）。ノート A の保存が
  B を開いた後に完了すると共有の `dirtyRef` を false にし、その隙に B への外部変更が
  「未編集」と判定されて**静かにリロード = B の編集が消える**
- ✅ 対応済み（同日） **ゴミ箱移動時の mtime 打ち直しが黙って失敗し得る**（`vault.rs:864` — `if let Ok` +
  `let _ =` で完全に無音）。失敗すると mtime が古いまま → 次回起動の
  `purge_trash(30)` が**30 日待たずに恒久削除**。失敗時はログ + 削除対象から
  外す形が要る
- ✅ 対応済み（同日） **履歴（唯一作り直せない資産）だけ非アトミック書き込み**（`history.rs:84` が素の
  `fs::write`。他は全部 save_atomic）。書き込み中に落ちると壊れた版が正常な顔で
  一覧に並ぶ。さらに `rekey` のマージ（:132）は `fs::rename` が行き先を黙って
  上書きするため、**別ノートの同一秒の版が消える**。削除済みノートの履歴フォルダを
  誰も消さないため、同名ノートを作り直すと**他人の過去の版が履歴に混ざる**
- ✅ 対応済み（同日） **履歴の復元が直後に古い本文で上書きされ得る**（App.tsx:722 — `autosave.cancel()`
  が `confirm` の後。確認中に 800ms 経過すると予約が発火）

## 中（機能が壊れる・UI が固まる・整合性）

### Rust 層

- ✅ 対応済み（同日） `note_exists` がフォルダごと外部削除されたとき false でなくエラーを返し、フロントの
  `void` 経路が全部飛ぶ → 削除ダイアログも退避も出ず、**自動保存が消したはずの
  フォルダとノートを復活させる**（commands.rs:159 + vault.rs:1285 + App.tsx:1631）
- ✅ 対応済み（同日） 索引の二重実行ガード `syncing` が `index_sync` にしか掛かっておらず、`vault_open` の
  背景 sync・`folder_rename` の sync と競合すると**改名直後のノートが一覧・検索から
  消える**（commands.rs:132/894。手動同期まで直らない）
- ✅ 対応済み（同日） **全 53 コマンドが非 async** = 逐次実行。OCR（実測 0.85s/枚）・Ollama プローブ
  （未導入環境で毎回 3 秒）・PDF 取り込み（ページ数 × OCR）・全 md 走査系で
  **UI が固まる**。`#[tauri::command(async)]` 化の検討を
- ✅ 対応済み（同日） `folder_relative` が既存フォルダ名にも sanitize を掛けるため、空白 2 つや `:` を
  含むフォルダは**画面に見えているのに改名・削除できない**／`move_note` は
  **そっくりな別フォルダを作ってそちらへ入れる**。`folder_rename` の履歴鍵の
  付け替えも生の引数を使うため、sanitize で変わる名前だと**配下全ノートの履歴が
  辿れなくなる**（vault.rs:533 + commands.rs:872）
- ✅ 対応済み（同日） NFC/NFD の非対称: `links.target` は正規化済み、`notes.title` は生のファイル名。
  `related_signals` / `link_map` だけ直接比較しており、NFD ファイル名のノートが
  **関連ノートとリンクの図からだけ落ちる**（index_db.rs:489/538）
- ✅ 対応済み（同日） LLM: 総時間の締切なし（read_timeout は無通信時間のみ）・`read_line` の長さ
  無制限・生成の中断手段なし・**パニックすると `generating` が立ちっぱなしで
  再起動まで LLM 機能が死ぬ**（`syncing` にも同型）・`timeout_minutes * 60` が
  debug でパニックし得る（llm.rs:138, commands.rs:616）
- `import_read` はファイル全体を base64 でメモリへ（500MB の PDF で約 2GB）。
  上限なし。`export_write_binary` だけ非アトミック（壊れた .pptx が残り得る）
- ✅ 対応済み（同日） watcher が**イベント 1 件ごとに SQLite を開き直す**（PRAGMA + CREATE TABLE 一式）。
  git checkout / 同期の一括変更で詰まり、FSEvents の合体で索引に穴が開く
- ✅ 対応済み（同日） `note_related` が 8 件のために `list_notes()` 全件（preview 込み）を読む。
  2 文字題名は LIKE の全表走査（commands.rs:787）
- ✅ 対応済み（同日） `vault_open` が vault を 2 回全走査（背景 sync + 戻り値用 scan）

### エディタ層

- ✅ 対応済み（同日） 閉じの無いコードフェンスで**コードの最終行が隠れて見えなくなる**
  （live-preview.ts:626 が閉じフェンス前提。input-assist.ts:64 は正しく
  CodeMark 数で判定しており、規則が食い違っている）
- ✅ 対応済み（同日） タイプライタモードの `typewriterScroll` が **IME ガード無しの updateListener から
  dispatch**（modes.ts:118、T5 違反。変換中の候補ウィンドウずれの恐れ）。
  microtask 前に捕まえた `head` が古い位置を指す問題も同居
- ✅ 対応済み（同日） 添付の貼り付け/ドロップが**保存前に捕まえた位置**へ挿入（attachments.ts:68）。
  保存待ちの間に打つと文字の途中に割り込み、文書が縮むと **RangeError**
- ✅ 対応済み（同日） Mermaid: `initialize({theme})` がグローバルなので複数図 + テーマ切替で
  **間違ったテーマの SVG が永久キャッシュ**。失敗時の掃除が `querySelectorAll` で
  **他の図の描画中要素まで消す**（mermaid.ts:60-106）
- ✅ 対応済み（同日） ` ```markdown ` フェンスの**中に**ライブプレビュー装飾が掛かる
  （live-preview.ts の iterate がフェンスへ潜り、入れ子言語の木も辿る。
  plain-copy.ts は正しく回避しており非対称）
- ✅ 対応済み（同日） オートリンク `<https://…>` が**丸ごと非表示**になる（MARK_NODES が LinkMark と
  URL の両方を隠す = Autolink の全構成要素）
- ✅ 対応済み（同日） 「すべて置換」が front matter に当たりを含むと**本文側の置換も全部無効**
  （frontmatter.ts:83 のガードが transaction 全体を破棄。フィードバックも無し）
- ✅ 対応済み（同日） 選択なしの Cmd+Shift+C が **front matter（id 等）ごとコピー**する
  （plain-copy.ts:59。stats.ts は除外しており非対称）
- ✅ 対応済み（同日） 表の自動整形が **Undo を 1 段消費**する（table-format.ts:242。
  addToHistory: false を検討）
- ✅ 対応済み（同日） `:::note` がコードフェンス内でも発火し、mermaid ブロックと装飾が重なる

### アプリ層

- 検索結果に世代ガードが無く、**遅いクエリの結果が後から新しい結果を上書き**
  （App.tsx:1198。`.catch` も無く索引故障時は無音）
- `async` ハンドラ 36 個中 try/catch は 17 個。`openNote`・新規作成・復元・
  完全削除・アシスタント等の失敗が**完全に無音**。`fetchLists` が 1 本失敗すると
  一覧更新イベント 3 種が全部無音で死ぬ
- 仮身化（切り出し）の題名サニタイズが Rust とずれ（`/` `:` 等）、本文の
  `[[リンク]]` が実ファイル名と食い違い**クリックすると 2 つ目のノートができる**
  （extract.ts:21 — `createNote` の戻り値からリンクを組み直すべき）
- 「保存した検索」は一覧ペイン（Cmd+2）を閉じていると**押しても無反応**
  （表示フラグが検索欄と別）
- ウィンドウを閉じるときの flush はコメントほど保証が無い（CloseRequested 処理が
  無く、**最後の 2 秒ぶんの打鍵はクラッシュ退避頼み**）

## 低（品質・保守性・将来の地雷）

- **live-preview.ts:324 に生の NUL バイト**が 2 つ埋まっており、`grep`/`git grep` が
  このファイルを**丸ごとスキップ**する（レビュー中に実害を確認。`"�"` 表記へ）
- ✅ 対応済み（同日） `guarded()` が検査後に**生のパス**を返す TOCTOU / `move_note` の行き先フォルダに
  実体ベースの封じ込め検査なし / `history_restore` の `version` が vault 内なら素通し
- ✅ 対応済み（同日） Mutex の `.expect()` がコマンド実行経路に 5 箇所 — どこかでパニックすると毒されて
  **以降の vault_open / watcher が全部落ち続ける**
- ✅ 対応済み（同日） `trash_days` が無検証で `SystemTime - Duration` のパニックに届く（checked_sub 化）
- vault 内シンボリックリンクでノートが**二重に索引**される（一覧に 2 つ並ぶ）
- `tauri.conf.json` の `csp: null` + 封じ込めの無い import/export コマンド
  （多層防御の観点。dangerouslySetInnerHTML は 2 箇所とも現状は安全側）
- ✅ 対応済み（同日） リンクの図: `dropped` の二重計上で「N 件を省いています」が過大 /
  索引同期中は `known` が空で全ノードが「まだ無い」表示
- 環境設定の数値入力が無検証（空欄 → 0 / NaN がその場だけ効く）
- ペイン幅ドラッグが `pointercancel` でリスナー残留
- モーダル 12 箇所に role/フォーカストラップ無し、Esc で閉じられないものが 5 つ
  （競合と外部削除は**キーボードだけでは脱出不能**）
- `RangeSet.empty` シングルトンを WeakMap のキーにしている（分割ペインを
  入れた瞬間に別文書のメタデータを読む地雷）
- auto-pair が選択ごとに `doc.toString()` / front matter があるとノート冒頭の
  打鍵ごとに全文 `toString()`（frontmatter.ts:69 の touchesRange が挿入にも真）
- ベンチの「本番と同じ拡張一式」コメントが実態と乖離（editorModes・補完・検索等が
  抜け、計測文書に数式・:::note・mermaid が無い）。**基準合格の実測が
  この経路を測っていない**
- **App.tsx が 3,045 行の単一ファイルで、App.tsx / stores/app.ts にテストが 1 件も
  無い**。本レビューの高リスク事故（flush 順序・競合中の保存・pendingSave の
  取り違え）はすべてこの層 — writeNote をモックした状態機械テストで固定できる
- テスト未カバーの実装分岐: 閉じない `$$`/フェンス、オートリンク表示、
  blockWidgetField の間引き、tableAutoFormat と Undo、attachmentEvents、
  typewriterScroll、copyPlainText の全文分岐、replace-all × front matter、
  フェンス内 :::note、mermaid 失敗経路、pptx.ts / export-code.ts / pdf-import.ts

## 問題なしと確認できたもの（抜粋）

- パス境界の主要経路（guarded / contains / trash の実体検査 / templates の封じ込め）
- SQL は全経路バインドパラメータ。FTS / LIKE のエスケープも正しい
- `save_atomic`（tempfile → fsync → rename、同一ディレクトリ・隠し tmp）
- `safeSubscribe` の StrictMode 対応、listen 6 箇所の規約順守、ref 経由の最新値読み
- localStorage 系の破損耐性（型検査 + 既定値フォールバック）
- last-vault の vault-busy 分岐、vault ロックの取得順
- T1 / T2 / T4 は遵守。T5 は modes.ts の 1 箇所のみ、T6 は blockWidgetField のみ逸脱

## 優先順（提案）

1. 性能退行の修復（treeGrew 判定 + blockWidgetField の間引き）— 基準割れの解消
2. `flush()` の Promise 化 + 競合中の `cancel` — データ消失系がまとめて消える
3. `$$` の食い潰し / percent_decode パニック / trash mtime 黙殺 / history の
   アトミック化 — 1 件ずつは小さい修正
4. `note_exists` のエラー化け + `syncing` ガードの拡張
5. コマンドの async 化（重いものから: OCR・LLM・import・attachments_unused）
