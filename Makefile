# 覚書（OboeGaki）Tauri 版の開発コマンド入口。hitofude と同じ流儀。

.PHONY: setup run test test-rust check fmt

setup:            ## 初回セットアップ
	npm install

run:              ## アプリ起動（Tauri dev = WKWebView）
	npm run tauri dev

test:             ## フロントエンドのテスト
	npx vitest run

test-rust:        ## Rust 側のテスト
	cd src-tauri && cargo test

check: test test-rust  ## コミット前チェック（型 + テスト全部）
	npx tsc --noEmit
