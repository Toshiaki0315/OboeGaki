# おぼえがき（OboeGaki）

ライブプレビュー型の Markdown エディタ。macOS 13+ / Tauri v2 / React 19 /
TypeScript / CodeMirror 6。表示名は「おぼえがき」（ADR-0047）、ファイル名や
ID 系は「OboeGaki」（ADR-0032）。参照実装（PySide6 版）は
`~/01_projects/hitofude` にあり、凍結維持している。

## できること（要点）

- **書きながら見える。** 記法はカーソルの行だけ現れる（インライン）。全部出す
  ソースモード、書き込んでいる行だけ出すプレビューモード（ADR-0065）を
  「表示 → 編集モード」で切り替える。フォーカス／タイプライターは併用できる
- **保管フォルダの `.md` がそのまま真実**（往復変換なし）。800ms の自動保存、
  版の履歴（ADR-0023）、外部変更の取り込みと競合の 3 択、クラッシュ時の退避
- 全文検索（SQLite FTS5）、タグ、ノートリンク `[[名前]]`（別名 `[[名前|表示]]`、
  埋め込み `![[名前]]`）、やること一覧、バックリンクと関連ノート、リンクの図
- 画像の貼り付けと大きさの調整、表（`Tab` でセル移動・行と列を足す）、
  Mermaid、数式、文字色、脚注
- 書き出し: HTML / PDF（印刷）/ PowerPoint（設定タブつき）/ Word。読み込み:
  PDF（文字の層が無ければ読み取り）/ PowerPoint / 画像
- ローカル LLM（Ollama）のアシスタント、文体チェック、どこからでも書き取り
- **MCP サーバ**（ADR-0051）。Claude Desktop などから検索・参照・作成・追記・
  差し替え・移動・ゴミ箱。`.mcp-ignore`（右クリック「Claude に渡さない」）で
  見せない場所を決める

## 開発

入口は `Makefile`。詳しい規約（TDD 必須・不可侵ルール T1〜T7・版の運用）は
[CLAUDE.md](CLAUDE.md)。

| 目的 | コマンド |
| --- | --- |
| 初回セットアップ | `make setup` |
| アプリ起動 | `make run`（dev サーバは 1430。`OBOEGAKI_DEV_PORT` で変更） |
| コミット前チェック | `make check`（prettier / eslint / vitest / tsc / cargo fmt・clippy・test） |
| CI と同じ手順 | `make ci` |
| .app / DMG | `make app` / `make dmg` |
| MCP サーバ | `make mcp` |

## 文書

- 仕様: [docs/spec.md](docs/spec.md)（Qt 前提の節は CLAUDE.md §4 の読み替え表を見る）
- 設計の記録: [docs/adr/](docs/adr/)（番号は hitofude から通し）
- やることと進捗: [docs/TASKS.md](docs/TASKS.md)
- 参照実装との差分: [docs/hitofude-gap.md](docs/hitofude-gap.md)
- 手動チェック（IME など機械で試せないもの）: [docs/manual_test.md](docs/manual_test.md)
- 性能の計測: [docs/bench.md](docs/bench.md)
- 移行時の技術検証: [spikes/](spikes/)（触らない・消さない）
