# 覚書（OboeGaki）Tauri 版の開発コマンド入口。hitofude と同じ流儀。

.PHONY: setup run test test-rust check fmt

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

check:            ## コミット前チェック（lint + 型 + テスト全部）
	npx prettier --check src
	npx vitest run
	npx tsc --noEmit
	cd src-tauri && cargo fmt --check
	cd src-tauri && cargo clippy -- -D warnings
	cd src-tauri && cargo test
