# 覚書（OboeGaki）Tauri 版の開発コマンド入口。hitofude と同じ流儀。

.PHONY: setup run test test-rust check fmt bench-search bench-startup bench

setup:            ## 初回セットアップ
	npm install

run:              ## アプリ起動（Tauri dev = WKWebView。初回は Rust ビルドで数分）
	npm run tauri dev

test:             ## フロントエンドのテスト
	npx vitest run

test-rust:        ## Rust 側のテスト
	cd src-tauri && cargo test

fmt:              ## フォーマット修正
	npx prettier --write src
	cd src-tauri && cargo fmt

bench-search:     ## 全文検索の実測（spec §6.6: < 200ms / 5,000 ノート）
	cd src-tauri && cargo run --release --bin bench

bench-startup:    ## 起動時間の実測（spec §6.6: < 1.5 秒。release を組んで測る）
	npm run tauri build -- --no-bundle
	OBOEGAKI_BENCH_STARTUP=1 src-tauri/target/release/oboegaki

bench: bench-search  ## 3 基準の計測（打鍵は bench.html — docs/bench.md 参照）
	@echo "打鍵の実測: npx vite を起動して http://localhost:5173/bench.html を開く"
	@echo "起動の実測: make bench-startup"

check:            ## コミット前チェック（lint + 型 + テスト全部）
	npx prettier --check src
	npx vitest run
	npx tsc --noEmit
	cd src-tauri && cargo fmt --check
	cd src-tauri && cargo clippy -- -D warnings
	cd src-tauri && cargo test
