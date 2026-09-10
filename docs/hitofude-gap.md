# hitofude にあって OboeGaki に無い機能（差分一覧）

- 作成: 2026-09-03。**棚卸し: 2026-09-11**（TASKS 12-10。「未実装」だった 45 行の
  ほぼ全部が実装済みになっていたので、行ごとにコードの場所を書いて直した。
  本当に開いているのは「署名・公証」「ショートカット一覧」「HTML のコード
  配色」だけ。ULID id はやらないと決めた）
- 出典: hitofude の docs/TASKS.md（タスク群 A〜U）・docs/adr/・全モジュール
  （core / storage / editor / ui）を走査して突き合わせた
- 「部分実装」= 目的は果たせるが挙動や範囲が hitofude と異なるもの

## 1. エディタの表示（ライブプレビュー）

| 機能                                                                                     | hitofude での根拠                                           | 状態                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| コードブロックのシンタックスハイライト（言語別の色分け・アクセント色・ファイル名ラベル） | core/code_tokens.py, ADR-0008                               | 実装済み（editor/code-blocks.ts・fence-language.ts。言語別の色分けとファイル名ラベル、ADR-0044 で桁揃えはやめた） |
| 数式 `$…$` / `$$…$$`（MathML 描画）                                                      | ADR-0009 / ADR-0020, editor/math_cache.py                   | 実装済み（ADR-0036。Temml で MathML、editor/math.ts）                                                             |
| Mermaid 図のインライン描画                                                               | ADR-0021, editor/mermaid_cache.py, resources/vendor/mermaid | 実装済み（ADR-0037。editor/mermaid.ts。PowerPoint には PNG で置く）                                               |
| 見出しの折りたたみ                                                                       | ADR-0019, core/folding.py                                   | 実装済み（editor/folding.ts）                                                                                     |
| front matter の完全隠蔽と解釈（id・pinned・日付・tags メタ）                             | ADR-0013, core/frontmatter.py, core/document.py             | 実装済み（editor/frontmatter.ts で隠す。pinned・tags は索引が読む。ULID id は持たない = 下の行）                  |
| 脚注 `[^1]` のエディタ内装飾                                                             | B-3                                                         | 実装済み（editor/extended-inline.ts。`/` メニューから挿せる）                                                     |
| 裸 URL の装飾と Cmd+クリック                                                             | inline_scanner の AUTOLINK / BARE_URL                       | 実装済み（live-preview.ts の autolink・editor/activation.ts の Cmd+クリック）                                     |
| 本文幅の設定・「どこまで書けるか」の可視化                                               | ADR-0016 / ADR-0018, Q-1 / Q-2                              | 実装済み（ADR-0018。5 段。「どこまで書けるか」の可視化は lib/text-width.ts）                                      |
| 文字サイズ変更（Cmd+±）・等幅フォント設定                                                | §5.2, editor_widget.set_base_point_size                     | 実装済み（lib/font-size.ts、環境設定の本文・等幅フォント）                                                        |
| 表: エディタを離れたときのソース整形                                                     | ADR-0003 決定 4, core/table.format_table                    | 実装済み（桁揃えは ADR-0044 でやめた）                                                                            |
| 表の挿入コマンド（行 × 列を指定して雛形を差し込む）                                      | commands.insert_table                                       | 実装済み（components/TableDialog.tsx。行 × 列を指定）                                                             |
| 表セル内の改行（`<br>`）                                                                 | ADR-0028                                                    | 実装済み（ADR-0028。live-preview.ts の FORCED_BREAK）                                                             |

## 2. 入力補助

| 機能                                                       | 根拠                                               | 状態                                          |
| ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| オートペア（選択して `*` `[` `(` `"` で囲む）              | §5.5-4, commands.AUTO_PAIRS                        | 実装済み（editor/auto-pair.ts）               |
| URL を選択の上に貼るとリンク化                             | §5.5-5, commands.is_url                            | 実装済み（editor/auto-pair.ts の isUrl）      |
| タグ補完（`#` 入力中に候補、↑↓ / Enter / Tab 選択）        | C-4, H-3, tags.prefix_at                           | 実装済み（editor/tag-complete.ts）            |
| ノートリンク補完（`[[` で候補）                            | core/notelink.py                                   | 実装済み（editor/note-link-complete.ts）      |
| コードフェンスの言語補完                                   | core/code_langs.py                                 | 実装済み（editor/fence-language.ts）          |
| 見出しサイクル（段落→H1→H2→H3→段落のボタン）               | B-1, commands.cycle_heading                        | 実装済み（TASKS 2-7 / ツールバーの H1）       |
| 複数行選択の行単位トグル（箇条書き / 番号 / 引用を揃える） | B-1, toggle_bullet / toggle_ordered / toggle_quote | 実装済み（TASKS 2-7）                         |
| 書式ツールバー                                             | B-1, ui/format_toolbar.py                          | 実装済み（本文の上・アイコンのみ + Tips）     |
| プレーンテキストとしてコピー（Cmd+Shift+C）                | §5.4                                               | 実装済み（editor/plain-copy.ts、Cmd+Shift+C） |

## 3. ノート管理・vault

| 機能                                                                            | 根拠                                          | 状態                                                                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 前回の vault を記憶して次回起動で自動的に開く                                   | config.vault_path, Q-6                        | 実装済み（lib/last-vault.ts。前回開いていたノートも開く = 3-22）                                |
| ピン留め（一覧の先頭固定・ピン中は削除ガード。front matter に永続化）           | §7.3, ui/note_actions.py                      | 実装済み（一覧の先頭固定・削除ガード・front matter に永続化。索引の pinned 列）                 |
| front matter の ULID id（改名・移動でも同一性が切れない索引/履歴の鍵）          | ADR-0023, core/document.py                    | **やらない**（ADR-0023 の決定: パスを鍵にし、改名・移動は history::rekey で付け替える）         |
| テンプレート（雛形から新規作成・日次テンプレート・Finder で追加可・初回シード） | E-4, core/template.py, resources/templates/   | 実装済み（vault.rs seed_templates / create_from_template、Cmd+Shift+N、「＋新規」の右クリック） |
| 同梱マニュアル「覚書の使い方」の初回シード                                      | vault.py MANUAL_*                             | 実装済み（vault.rs seed_manual / place_manual。ヘルプから置き直せる）                           |
| フォルダの作成・改名（アプリ内から）                                            | ADR-0024, vault.create_folder / rename_folder | 実装済み。**Drag & Drop での移動**も足した（ADR-0024 追記 7。参照実装には無い）                 |
| サイドバーのフォルダツリー表示                                                  | ui/sidebar.py, ADR-0024                       | 実装済み（components/FolderSection.tsx。畳める = 3-23、直下 0 の括弧 = ADR-0024 追記 6）        |
| 保存した検索（サイドバーに常駐）                                                | ui/sidebar.py                                 | 実装済み（components/SavedSearchSection.tsx、lib/saved-searches.ts）                            |
| ゴミ箱の自動掃除（30 日、日数設定可）                                           | §7.6, purge_trash                             | 実装済み（vault.rs purge_trash。日数は環境設定）                                                |
| ゴミ箱からの完全削除・「ゴミ箱を空にする」                                      | §7.6, note_actions                            | 実装済み（「ゴミ箱を空にする」。App の handleEmptyTrash）                                       |
| 画像の貼り付け / ドロップ取り込み（attachments/ へ保存して `![]()` を挿入）     | A-2, editor/attachments.py                    | 実装済み（TASKS 1-2）。**SVG も受ける**（参照実装は QtSvg 無しで描けず対象外。2026-09-09）      |
| 未使用の添付の片づけ（どのノートからも指されない画像の掃除）                    | E-5, vault.unused_attachments                 | 実装済み（references.rs、commands attachments_unused / attachments_trash）                      |
| ノートの複製ほか一覧の右クリックメニュー                                        | ui/note_actions.py                            | 実装済み（複製・フォルダへ移動・ゴミ箱・ピン。components/ContextMenu.tsx）                      |
| 仮身化（選択範囲を新しいノートに切り出してリンクを残す）                        | M-1, core/extract.py                          | 実装済み（lib/extract.ts、M-1）                                                                 |
| リンクの図（ノート間関係のグラフ表示）と続柄ラベル                              | M-2 / M-3, core/graph.py, ui/graph_window.py  | 実装済み（components/GraphDialog.tsx、lib/graph.ts、index_db link_map）                         |
| ファイルと索引を手で合わせ直すメニュー                                          | M-6                                           | 実装済み（index_sync。M-6。保管フォルダを選び直すと全部作り直す = 3-37）                        |
| クラッシュ退避（未保存の内容を退避し、起動時に復元を提案）                      | H-1, autosave.stash / recovery                | 実装済み（recovery.rs、useNoteSync の stash。起動時に復元を提案）                               |
| 外部で削除されたノートの「再作成しますか？」ダイアログ                          | §7.5                                          | 実装済み（useNoteSync の deleted → 作り直す / 閉じる）                                          |

## 4. 検索・ナビゲーション

| 機能                                                | 根拠                                             | 状態                                                                              |
| --------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| 検索式（語の組み合わせ・タグ条件などの構文）        | core/searchquery.py                              | 実装済み（search_query.rs。`#タグ` / `after:` / `before:`）                       |
| タグによる厳密な絞り込み（タグ索引でのフィルタ）    | index_db の tags 結合                            | 実装済み（索引の tags 表で引く。useSearch の tagNotes）                           |
| バックリンク（このノートを指すノートの帯）          | E-6, ui/backlink_bar.py, index の links テーブル | 実装済み（components/BacklinkBar.tsx、index_db backlinks）                        |
| 関連ノートの提示                                    | core/related.py                                  | 実装済み（related.rs、index_db related_signals。アシスタントペイン）              |
| 見出しパレット（Cmd+R。飛んだら閉じる道具）         | C-2                                              | 実装済み（Cmd+R。App の見出しパレット）                                           |
| `:::note` の囲み（Qiita 記法 / info・warn・alert）  | B-3, core/block_parser / html.py                 | 実装済み（移行の一覧から漏れていた。実機報告 2026-09-04 で判明）                  |
| ペイン開閉（Cmd+1 / Cmd+2）と幅のドラッグ調整・保存 | §5.4, ui/panes.py                                | 実装済み（Cmd+1 / Cmd+2、幅のドラッグと保存 = settings.listWidth / outlineWidth） |

## 5. アプリ・設定

| 機能                                                                             | 根拠                               | 状態                                                                                    |
| -------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| 環境設定ダイアログ（フォントサイズ・履歴の間隔・ゴミ箱の日数・本文幅・テーマ等） | ui/preferences.py, N-1             | 実装済み（components/PreferencesDialog.tsx。一般 / PowerPoint / アシスタントの 3 タブ） |
| テーマの手動切替（ライト / ダーク / システム）                                   | theme.py, §5.3                     | 実装済み（settings.theme: system / light / dark）                                       |
| ステータスバーの文字数・行数・保存時刻                                           | core/stats.py, ui/status_bar.py    | 実装済み（editor/stats.ts、components/StatusBar.tsx）                                   |
| ショートカット一覧（C-7）                                                        | ui/shortcut_sheet.py               | 未実装（メニューバーに全ショートカットが並ぶので代替。要望があれば）                    |
| 既定の保管フォルダ（`~/Documents/OboeGakiNotes`。旧名が在れば使い続ける）        | ADR-0032 決定 3, config.vault_path | 実装済み（2026-09-05）                                                                  |
| ウィンドウの位置・サイズの保存                                                   | config.window_geometry             | 実装済み（tauri-plugin-window-state）                                                   |
| シングルインスタンス・vault ロック（二重起動の安全化）                           | H-1, app.acquire_vault_lock        | 実装済み（tauri-plugin-single-instance、vault_lock.rs の flock）                        |
| 文章チェック                                                                     | core/style_check.py                | 実装済み（lib/style-check.ts、components/StyleCheckDialog.tsx）                         |
| 参照ペイン（もう 1 枚のノートを本文の横に読むだけで置く。「横に開く」）          | U-1, ui/reference_pane.py          | 実装済み（2026-09-04。右のペインの 1 枠に入る）                                         |

## 6. 取り込み・書き出し

| 機能                                                             | 根拠                                                   | 状態                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| PDF 書き出し・印刷                                               | ADR-0007, editor/exporter.py                           | 実装済み（ADR-0038。印刷の窓から PDF）                                                                                    |
| HTML 書き出しのコード色分け（Pygments 相当）                     | core/html._code_html                                   | 部分実装（言語クラスは付くが配色なし。画面の色分けを写すかは未決）                                                        |
| PowerPoint 取り込み（F-3）・書き出し（F-5）・スライド分割（F-4） | editor/pptx_import.py / pptx_export.py, core/slides.py | 実装済み（lib/pptx-import.ts / pptx.ts / slides.ts、第 5・8 群。Mermaid は PNG）                                          |
| 外部形式の取り込み（F-1。貼り付け・PDF 経由含む）                | editor/importer.py, core/imported.py                   | 実装済み（lib/imported.ts、PDF は pdf.rs + OCR）                                                                          |
| OCR（画像・PDF から文字を読む。Swift 製ツール同梱）              | ADR-0027, tools/ocr/                                   | 実装済み（macOS は Rust から Vision を直に = ADR-0041。ローカルLLM は Ollama に画像を添える。2026-09-07 に 2 択が揃った） |

## 7. ローカル LLM（アシスタント）

| 機能                                                                                                                  | 根拠                                                                                   | 状態                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ollama 連携（要約・レビュー・関連・止める・vault 全体への質問。Cmd+6 のアシスタントペイン、モデル管理、応答待ち設定） | ADR-0025, core/llm.py / keywords.py / related.py, ui/assistant_pane.py, docs/ollama.md | 実装済み（llm.rs、hooks/useAssistant.ts、components/AssistantPane.tsx。OCR のローカル LLM も） |

## 8. 配布・その他

| 機能                                       | 根拠               | 状態                                                        |
| ------------------------------------------ | ------------------ | ----------------------------------------------------------- |
| 署名・公証                                 | TASKS 0-C          | 未実装（Apple Developer アカウント待ち。hitofude 側も同じ） |
| 配布バリアント（Lite 版 = Mermaid 無し等） | R-1〜R-3, setup.py | 未検討（現状の DMG が 5.4MB なので必要性が低い）            |

---

## 参考: OboeGaki 側にしか無いもの・挙動差の注記

- **タイプライタモード中の `scrollPastEnd`**（文末の先までスクロール可）は
  CM6 版のみの挙動
- **リビールの単位**が一部異なる: 画像はカーソルでソースが出る（hitofude は
  出さない = ADR-0004 決定 4）、表は表単位（hitofude の折り返し表示は行単位 =
  ADR-0017 決定 4）。いずれも Qt 実装固有の制約が動機だったため CM6 では
  統一した（ADR-0035 参照）
- **履歴の間引き**は環境設定で 0/15/30/60/120 分（hitofude と同じ。既定 60 分）
- **索引のスキーマ**は必要分だけ（links・tags・pinned はある。ULID id と
  created/modified 列は未導入）。捨てられるキャッシュなので、機能追加時に
  世代を上げて拡張する
- **OboeGaki 側にしか無いもの**: フォルダの Drag & Drop 移動（ADR-0024 追記 7）、
  ノートの複数選択とまとめて落とす（追記 8）、SVG の添付、箇条書きのぶら下げ、
  見出しからのファイル名追従の H1 限定、PowerPoint の設定タブ（第 8 群）、
  MCP サーバ（ADR-0051、予定）
