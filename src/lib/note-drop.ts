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

/// この落下は Finder などからのファイルか（`dataTransfer.types` に `Files`）。
/// ファイルの落下を誰も受けないと、WebKit は**そのファイルをページとして
/// 開いてしまう**（実機報告 2026-09-08: 画像が窓いっぱいに出た）ので、
/// 窓の外側で必ず受ける。
export function isFileDrag(types: readonly string[]): boolean {
  return types.includes("Files");
}

/// フォルダを掴んでいるときの目印（要望 2026-09-10）。ノートとは別の型
export const FOLDER_DRAG_TYPE = "application/x-oboegaki-folder";

export function isFolderDrag(types: readonly string[]): boolean {
  return types.includes(FOLDER_DRAG_TYPE);
}

/// このフォルダをこのフォルダの中へ動かせるか。自分の中・子の中は
/// フォルダが消えるので不可。今の親へは動かないので受けない（受けても
/// 何も起きないのに「移しました」になる）。区切りで見る — 「仕事」を
/// 「仕事場」の中へは動かせる
export function canMoveFolderInto(folder: string, into: string): boolean {
  if (!folder) return false;
  if (into === folder || into.startsWith(`${folder}${SEPARATOR}`)) return false;
  const cut = folder.lastIndexOf(SEPARATOR);
  const parent = cut < 0 ? "" : folder.slice(0, cut);
  return parent !== into;
}
