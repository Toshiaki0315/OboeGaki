// 見出しとファイル名の追従（ADR-0005 追記、要望 2026-09-10）。
//
// 題名の真実は本文（T1）。「名前を変更」は Rust 側が本文の見出しを書き換え
// （`Vault::rename` → `with_title`）、ここは逆向き — 本文の H1 が変わったら
// 保存のあとでファイル名を追わせる — の判断材料を出す純関数。

/// 最初の H1 の文字。front matter とコードフェンスの中は見ない。
/// `##` 以下は「一番上の見出し」ではないので数えない。無ければ null
export function firstHeading(text: string): string | null {
  const lines = text.split("\n");
  let inFrontMatter = false;
  let inFence = false;
  for (let number = 0; number < lines.length; number++) {
    const line = lines[number];
    if (number === 0 && line.trimEnd() === "---") {
      inFrontMatter = true;
      continue;
    }
    if (inFrontMatter) {
      if (line.trimEnd() === "---") inFrontMatter = false;
      continue;
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const found = /^# +(\S.*)$/.exec(line);
    if (found) {
      const cleaned = found[1].split(/\s+/).filter(Boolean).join(" ");
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/// ファイル名の幹に直したときの形（Rust の `sanitize_filename` と同じ規則の
/// 写し）。「今のファイル名は見出しに従っているか」を見るための比較用で、
/// 実際の名前は Rust が決める
export function sanitizeStem(title: string): string {
  let text = "";
  for (const character of title.normalize("NFC")) {
    if (/[\p{Cc}\p{Cf}]/u.test(character) && !/\s/.test(character)) continue;
    text += /[/:\\]/.test(character) ? "-" : character;
  }
  return text.split(/\s+/).filter(Boolean).join(" ").replace(/^\.+/, "").trim();
}
