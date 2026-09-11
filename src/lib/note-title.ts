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
      const cleaned = stripInline(found[1])
        .split(/\s+/)
        .filter(Boolean)
        .join(" ");
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

/// 見出しの装飾を落として素の文字にする（実機 2026-09-11: 色と打ち消しを
/// 付けた H1 がそのままファイル名とタイトルバーに出た）。本文は触らない —
/// 題名に持ち込まないだけ。
/// - HTML タグは全部落とす（色の span も、受けない style も）
/// - 画像は説明、リンクは文字、WikiLink は表示名（無ければ名前）
/// - 強調・打ち消し・コード・マーカーの記号を落とす
export function stripInline(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, name: string, shown?: string) => shown ?? name,
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|::|`)/g, "")
    .replace(/(^|[\s(（])[*_](?=\S)/g, "$1")
    .replace(/(?<=\S)[*_](?=[\s)）,.。、]|$)/g, "")
    .trim();
}
