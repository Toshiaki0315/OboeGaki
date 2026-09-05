// フォルダを Finder で開く（要望 2026-09-05）。
//
// **開ける先は保管フォルダの中だけ。** ここでは道を組み立てるだけで、
// 中かどうかを確かめるのは Rust 側（`open_in_finder`）の仕事。

/// ゴミ箱の場所（保管フォルダからの相対）。Rust 側の `TRASH_DIR` と同じ。
export const TRASH_FOLDER = ".trash";

/// 保管フォルダからの相対名を、開ける形の道にする。
/// 空文字は保管フォルダそのもの（一覧の「直下」の行）。
export function finderTarget(root: string, folder: string): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return folder ? `${base}/${folder}` : base;
}
