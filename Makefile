# 覚書（OboeGaki）Tauri 版の開発コマンド入口。hitofude と同じ流儀。

.PHONY: setup run test test-rust check ci fmt bench-search bench-startup bench dmg

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

dmg:              ## インストール用 DMG を新規ビルドから作る（hitofude の make dmg と同役）
	npm run tauri build
	@echo "DMG: src-tauri/target/release/bundle/dmg/"
	@echo "署名・公証は Apple Developer アカウント取得後（hitofude TASKS 0-C と同じ）"

# CI（.github/workflows/check.yml）と同じ手順を、同じ順で、ローカルで回す。
# ランナーは macOS 専用（objc2-vision を使うので Linux では組めない）ため、
# act のような Linux コンテナ実行では代われない。**手元の Mac が同じ環境**
# なので、CI が足していたのは「コミット済みの状態を、まっさらな取得から
# 再現できるか」だけ。そこを worktree + npm ci で再現する。
# ビルドの中間物だけは手元のものを使い回す（毎回 10 分待たない）
ci:               ## CI と同じ手順をローカルで（コミット済みの状態を取り出して回す）
	@set -e; \
	root="$$PWD"; \
	tmp="$$(mktemp -d)"; dir="$$tmp/oboegaki"; \
	echo "== HEAD を $$dir に取り出す（追跡外のファイルは持ち込まない） =="; \
	git worktree add --detach "$$dir" HEAD >/dev/null; \
	status=0; \
	( set -e; cd "$$dir"; \
	  export CARGO_TARGET_DIR="$$root/src-tauri/target"; \
	  npm ci; \
	  npx prettier --check src; \
	  npx vitest run; \
	  npx tsc --noEmit; \
	  cd src-tauri; \
	  cargo fmt --check; \
	  cargo clippy -- -D warnings; \
	  cargo test ) || status=$$?; \
	git worktree remove --force "$$dir"; \
	rm -rf "$$tmp"; \
	if [ $$status -eq 0 ]; then echo "== CI と同じ手順が緑 =="; else echo "== 失敗（終了コード $$status） =="; fi; \
	exit $$status

check:            ## コミット前チェック（lint + 型 + テスト全部）
	npx prettier --check src
	npx vitest run
	npx tsc --noEmit
	cd src-tauri && cargo fmt --check
	cd src-tauri && cargo clippy -- -D warnings
	cd src-tauri && cargo test
