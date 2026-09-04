/// ゴミ箱の行の見せ方。
///
/// **題名を主にする。** `仕事/2026-09-04 議事録` のような 1 本の長いパスは、
/// 幅の狭い一覧では折り返して 3 行になり、どれがどれか分からなくなる
/// （要望 2026-09-04）。題名とフォルダに分けて、フォルダは添えに回す。

const EXTENSION = /\.(md|markdown)$/i;

/// vault からの相対の位置（`仕事/議事録`）。確認の文に使う。
export function trashLabel(root: string, path: string): string {
  const prefix = `${root}/.trash/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return relative.replace(EXTENSION, "");
}

/// 題名と、元が入っていたフォルダ（直下なら空）。
export function trashParts(
  root: string,
  path: string,
): { name: string; folder: string } {
  const label = trashLabel(root, path);
  const cut = label.lastIndexOf("/");
  return cut < 0
    ? { name: label, folder: "" }
    : { name: label.slice(cut + 1), folder: label.slice(0, cut) };
}
