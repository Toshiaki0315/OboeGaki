// タグ名の正規化。Rust `tags::normalize` と同じ規則（`/` で割って空の成分を
// 落とし、小文字に）。共有の見本 fixtures/tag-cases.json が両側を見張る（17-8）。

export function normalizeTag(raw: string): string {
  return raw
    .split("/")
    .filter((part) => part !== "")
    .join("/")
    .toLowerCase();
}
