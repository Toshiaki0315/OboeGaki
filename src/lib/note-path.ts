// ノートのパスから画面に出す名前を作る。題名はファイル名の幹（ADR-0005）。

/// 保管フォルダからの相対パス（拡張子なし）。フォルダ込みで表示する。
export function noteLabel(root: string, path: string): string {
  const relative = path.startsWith(root) ? path.slice(root.length + 1) : path;
  return relative.replace(/\.(md|markdown)$/i, "");
}

/// ファイル名の幹（フォルダも拡張子も外す）。題名として使う。
export function noteStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(md|markdown)$/i, "");
}

/// 見出し（相対パス）のうちフォルダの部分。直下なら空。
export function labelFolder(label: string): string {
  const cut = label.lastIndexOf("/");
  return cut < 0 ? "" : label.slice(0, cut);
}

/// ノートが入っているフォルダ（保管フォルダからの相対）。直下なら空。
export function noteFolder(root: string, path: string): string {
  return labelFolder(noteLabel(root, path));
}
