// HTML の逃がし。属性値にも置くので `"` `'` まで落とす（`alt` や `class` を
// 突き破らせない）。export-html と export-code が同文で 2 つ持っていた（17-6）

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
