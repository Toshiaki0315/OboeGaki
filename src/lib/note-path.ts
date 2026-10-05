// ノートのパスから画面に出す名前を作る。題名はファイル名の幹（ADR-0005）。

/// ノートの拡張子。施錠ノート（`.md.enc`。ADR-0062）も題からは印ごと外す。
/// **ここが唯一の出所**（一覧・ゴミ箱・競合の知らせが別々に持っていた）
export const NOTE_EXTENSION = /\.(md\.enc|md|markdown)$/i;

/// 施錠ノートか（名前だけで見る。Rust の `vault::is_locked_note` と同じ規則）
export function isLockedPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return /^.+\.md\.enc$/i.test(base);
}

/// 保管フォルダからの相対パス（拡張子なし）。フォルダ込みで表示する。
export function noteLabel(root: string, path: string): string {
  // `${root}/` で見る（nfcUnder と同じ規則。`root` だけだと末尾に `/` がある root で
  // 1 文字ずれ、`/vault2/…` も `/vault` の下に見えた。21-4）
  const relative = path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path;
  return relative.replace(NOTE_EXTENSION, "");
}

/// ファイル名の幹（フォルダも拡張子も外す）。題名として使う。
export function noteStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(NOTE_EXTENSION, "");
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

/// root からの相対部分を Unicode NFC に揃えた絶対パス（root はそのまま）。
/// Rust 側の `vault::nfc_under` と同じ約束（ADR-0050）。索引・監視イベントは
/// NFC で来るので、開くときのパスもここで揃えないと「別のノート」に見える —
/// 前回開いていたノートの記憶（last-note）に NFD が残っていることがある
export function nfcUnder(root: string, path: string): string {
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return path;
  return prefix + path.slice(prefix.length).normalize("NFC");
}
