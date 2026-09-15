// 編集モード（要望 2026-09-15）。インライン（ふつうのライブプレビュー）／
// ソース（全部の記法を出す）／プレビュー（書き込んでいる行だけ記法を出す。
// ADR-0065）の 3 つで、**必ずどれか 1 つ**。エディタの持ち物は source と
// wysiwyg の 2 つの真偽値で、インラインは「どちらも切」— ここでその読み替えを
// 1 か所に持つ（メニューの ✓ は lib/menu-checks、右上のボタンは NoteActions）。

export type EditMode = "inline" | "source" | "preview";

export const EDIT_MODE_LABELS: Record<EditMode, string> = {
  inline: "インラインモード",
  source: "ソースモード",
  preview: "プレビューモード",
};

/// エディタの 2 つの真偽値から今のモードへ。同時に立つことは field の排他で
/// 起きないが、来たらソースを優先する（全部見せるほうが安全）
export function editModeOf(modes: {
  source: boolean;
  preview: boolean;
}): EditMode {
  if (modes.source) return "source";
  if (modes.preview) return "preview";
  return "inline";
}

/// 右上のボタンで巡る順（メニューの並びと同じ）
export function nextEditMode(mode: EditMode): EditMode {
  switch (mode) {
    case "inline":
      return "source";
    case "source":
      return "preview";
    case "preview":
      return "inline";
  }
}
