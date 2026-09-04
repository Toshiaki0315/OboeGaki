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

/// 掴んでいるものに載せる目印。**専用の型を作る。**
/// `text/plain` で見分けると、よそからの文字の落下まで受けてしまう。
export const NOTE_DRAG_TYPE = "application/x-oboegaki-note";

/// この落下はノートのものか（`dataTransfer.types` から判断する）。
///
/// 中身（`getData`）は落とすまで読めない決まりなので、途中の判断は
/// 型の一覧だけで行う。
export function isNoteDrag(types: readonly string[]): boolean {
  return types.includes(NOTE_DRAG_TYPE);
}
