#!/bin/sh
# 版を 1 つ上げる（要望 2026-09-11: 挙動を変えるコミットごとに 0.5.x の x を
# 上げ、0.6.0 に上げたら x は 0 から）。
#
#     make bump              # 0.5.3 → 0.5.4
#     make bump LEVEL=minor  # 0.5.3 → 0.6.0
#
# 版は 3 箇所（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json）
# に同じ字面で持つ。手で直すと漏れるので、ここで一度に書く。揃っていることは
# Rust のテスト（lib.rs: 版は 3 箇所が揃い）が見張る。
set -eu
level="${1:-patch}"
case "$level" in
  patch|minor|major) ;;
  *) echo "LEVEL は patch / minor / major: $level" >&2; exit 2 ;;
esac
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
before="$(node -p "require('./package.json').version")"
# package.json と package-lock.json は npm に書かせる（タグは打たない）
npm version "$level" --no-git-tag-version >/dev/null
after="$(node -p "require('./package.json').version")"
# Cargo.toml: [package] の version（最初の 1 行だけ）。BSD sed に `0,/re/` は
# 無いので awk で書く
awk -v before="version = \"$before\"" -v after="version = \"$after\"" '
  !done && $0 == before { $0 = after; done = 1 } { print }
' src-tauri/Cargo.toml > src-tauri/Cargo.toml.tmp && mv src-tauri/Cargo.toml.tmp src-tauri/Cargo.toml
# tauri.conf.json: 字面を保つため node で書き戻す
node -e '
const fs = require("fs");
const p = "src-tauri/tauri.conf.json";
const conf = JSON.parse(fs.readFileSync(p, "utf8"));
conf.version = process.argv[1];
fs.writeFileSync(p, JSON.stringify(conf, null, 2) + "\n");
' "$after"
# Cargo.lock の自分の版も揃える（ネットには出ない）
(cd src-tauri && cargo update --workspace --offline --quiet)
echo "$before → $after"
