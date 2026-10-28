# ADR-0071: アシスタントの頼み先に macOS 27 の `fm` を選べるようにする

- 状態: **採用**（2026-10-28）
- 日付: 2026-10-28
- 関連: ADR-0025（ローカル LLM・送り先は 127.0.0.1 に固定・外へ出さない）、
  ADR-0070（議事録。区切って 2 段）、ADR-0027（文字の読み取り）

## 背景

macOS 27 で、Apple の Foundation Models を端末から呼べる `fm` コマンドが入った
（WWDC 2026 セッション 334）。`fm respond "<頼み>"` で答えが標準出力に返り、既定は
**端末内のモデル**。Ollama を入れなくても要約や整形ができるので、メニューから
Ollama と `fm` を選べるようにしてほしい、という要望（2026-10-28）。

## 決定

1. **頼み先を設定に持つ**（`llmEngine: "ollama" | "fm"`。既定は Ollama = 今までどおり）。
   「表示 → アシスタントの頼み先」（印つき・排他）と環境設定「アシスタント」タブの両方で選べる。
   アシスタント（要約・レビュー・問い・質問）と議事録がこれに従う。
2. **`fm` は子プロセスで呼ぶ**（`src-tauri/src/fm.rs`。transcribe.rs と同じ形）。頼みは 1 つの
   引数で渡し、標準出力を流れてきた順に画面へ送る。止める・無通信の時間切れ・失敗時の
   標準エラーの言い分は Ollama と同じ `LlmError` で返す（画面は頼み先によらず同じ言葉で受ける）。
3. **端末内のモデルだけを使う。** `--model pcc`（Private Cloud Compute）はノートが Mac の外へ
   出るので渡さない（ADR-0025 の約束を `fm` でも守る）。
4. **`fm` の無い Mac にはメニューの切り替えを出さない**（`/usr/bin/fm`・`/usr/local/bin/fm` を見る。
   選べるものが 1 つの切り替えは効かないつまみ）。環境設定では「macOS 27 以降」と書いて出す。
   選んであるのに無ければ、アシスタントの欄で macOS 27 と Apple Intelligence を案内する。
5. **fm を選んだら Ollama の項（モデル・議事録のモデル・ポート・一度に渡す量・残す時間）を
   隠す**（効かない）。応答待ち時間は fm にも効く。「モデルを降ろす」は fm では何もしない。
6. **議事録の区切りを小さくする**（fm は 2,000 字。Ollama は 8,000 字のまま）。端末内のモデルの
   窓は Ollama の既定より小さい。

## 持たないもの

- 文字の読み取り（OCR）の「ローカルLLM」は Ollama のまま（`fm --image` は未検証）。
- Private Cloud Compute（決定 3）。

## 根拠

- `fm` の呼び方は WWDC 2026 セッション 334 の例（`fm respond "..."`・`--instructions`・
  `--model pcc`・`--image`・`--schema`）。**macOS 27 の実機ではまだ確かめていない**
  （開発機は macOS 26.7.1）。置き場（`/usr/bin/fm`）・流し方（少しずつ出すか、最後にまとめて出すか）・
  窓の大きさ・日本語の出来は実機で確かめ、違えばここに追記する
  （手で回すテスト: `cargo test fm::tests::test_本物 -- --ignored --nocapture`）。
- `fm.rs` は偽の `fm`（シェルのスクリプト）で、引数・流し方・多バイト文字の切れ目・止める・
  時間切れ・失敗の言い分をテストしている。

## 影響

- Rust: `fm.rs`（新規）、`commands/llm.rs`（`Engine`・`generate_by`・`fm_available`）、
  `commands/transcribe.rs`（議事録の頼み先と区切り）、`menu.rs`（頼み先の小メニュー）。
- TS: `settings.ts`（`llmEngine`）、`menu-checks.ts`（`engineChecks`。fixtures/menu-checks.json）、
  `ipc-llm.ts`（`fmAvailable`）、`useAssistant` / `useTranscribe`、`AssistantPane` / `AssistantPreferences`。
- 不可侵ルール: T3（fm.rs は Tauri 非依存）を守る。T5 は関係しない（打鍵の経路に入れない）。
