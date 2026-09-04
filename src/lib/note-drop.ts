/// ノートをフォルダへ落とす（Drag & Drop）ときの判断。
///
/// **同じフォルダへの落下は断る。** 受け付けても何も起きないのに
/// 「移しました」と言うことになり、失敗と区別が付かない。

const SEPARATOR = "/";

/// vault からの相対で見た、そのノートが入っているフォルダ（直下なら空）。
export function folderOf(root: string, path: string): string {
  const prefix = `${root}${SEPARATOR}`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const cut = relative.lastIndexOf(SEPARATOR);
  return cut < 0 ? "" : relative.slice(0, cut);
}

/// このノートをこのフォルダへ落とせるか。
export function canDropInto(
  root: string,
  path: string,
  folder: string,
): boolean {
  return folderOf(root, path) !== folder;
}
