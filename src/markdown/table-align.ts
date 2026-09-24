// 表の区切り行のセル（`:---:` など）から揃えを読む（GFM。21-4）。表の widget
// （live-preview-table-data）と表の整形（table-format）が別々に持っていた

export type TableAlign = "left" | "center" | "right" | null;

/// `:---` は左、`---:` は右、`:---:` は中央、印が無ければ null（既定）
export function tableAlign(cell: string): TableAlign {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}
