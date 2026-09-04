// 書式ツールバー（B-1）の台帳。参照実装 ui/format_toolbar.py の移植。
//
// **ここは並びと呼び名だけを持つ。** 変換は format-commands の
// FORMAT_COMMANDS が持っていて、ツールバーはそれを呼ぶだけ。同じ操作に
// ショートカット・メニュー・ボタンの 3 つの入口ができるが、中身が 1 つなら
// 食い違わない。
//
// **絵は線で描く（絵文字も画像も使わない）。** 絵文字は色を指定できず
// テーマから浮き、画像はライト / ダーク × 解像度のぶん要る。線なら
// currentColor が効く（参照実装 ui/icons.py と同じ判断）。
// 形は 16×16 で、既存のアイコン（ピン・書き出し）と同じ太さに揃える。

import { FORMAT_KEYS, type FormatKind } from "./format-commands";

/// 表だけは書式ではなく「行と列を聞く窓」を開く（押した先が違う）。
export type ToolbarKind = FormatKind | "table";

export type ToolbarItem = {
  kind: ToolbarKind;
  label: string;
  /// 16×16 の線。すべて stroke = currentColor で描く
  paths: readonly string[];
};

/// `Mod-b` → `⌘B`。**見せるときだけ直す**（台帳は登録できる形で持つ）。
/// macOS 専用（ADR-0012）なので Mod は常に ⌘。
export function nativeKey(key: string): string {
  const symbols: Record<string, string> = {
    Mod: "⌘",
    Cmd: "⌘",
    Ctrl: "⌃",
    Shift: "⇧",
    Alt: "⌥",
  };
  return key
    .split("-")
    .map(
      (part) =>
        symbols[part] ?? (part.length === 1 ? part.toUpperCase() : part),
    )
    .join("");
}

/// ボタンに出す説明。アイコンだけなので、**呼び名はここが唯一の手掛かり**。
/// ショートカットも添える（覚えていなくても押せて、押すうちに覚えられる）。
export function formatHint(item: { kind: ToolbarKind; label: string }): string {
  const key = FORMAT_KEYS[item.kind as FormatKind];
  return key ? `${item.label}（${nativeKey(key)}）` : item.label;
}

// 並びは「文字の装飾 → 行の書式 → 差し込むもの」。押す頻度の順ではなく
// 種類でまとめる — 目で探すとき、ひとかたまりになっているほうが早い。
// 群の切れ目には区切り線を引く（描くのは App 側）
export const FORMAT_TOOLBAR: readonly (readonly ToolbarItem[])[] = [
  [
    {
      kind: "strong",
      label: "太字",
      paths: [
        "M5.5 3.5v9M5.5 3.5h3a2.25 2.25 0 0 1 0 4.5h-3",
        "M5.5 8h3.7a2.25 2.25 0 0 1 0 4.5H5.5",
      ],
    },
    {
      kind: "emphasis",
      label: "斜体",
      paths: ["M6.5 3.5h4M5.5 12.5h4M9.5 3.5 7 12.5"],
    },
    {
      kind: "strike",
      label: "打ち消し",
      paths: [
        "M11 5.4a3 3 0 0 0-2.8-1.9c-1.7 0-2.8 1-2.8 2.2 0 .9.6 1.5 1.6 1.9",
        "M5 10.6a3.2 3.2 0 0 0 3 2c1.8 0 2.9-1 2.9-2.3 0-.5-.1-.9-.4-1.3",
        "M2.5 8h11",
      ],
    },
    {
      // 山括弧にスラッシュ。ソース表示（`< >`）と見分けが付く形にする
      kind: "code",
      label: "コード",
      paths: [
        "M5.5 4.5 2.5 8l3 3.5M10.5 4.5 13.5 8l-3 3.5",
        "M9.3 3.5 6.7 12.5",
      ],
    },
    {
      // 引いた線。ペン先と、その下に太く残る跡
      kind: "highlight",
      label: "マーカー",
      paths: ["M4.5 10.5 10 5l1.8 1.8-5.5 5.5H4.5z", "M3 14h10"],
    },
  ],
  [
    {
      kind: "heading",
      label: "見出し",
      paths: ["M4 3.5v9M4 8h5.5M9.5 3.5v9", "M11.4 8.6l1.2-.9v4.8"],
    },
    {
      kind: "bullet",
      label: "箇条書き",
      paths: ["M3 4.5h.01M3 8h.01M3 11.5h.01", "M6 4.5h7M6 8h7M6 11.5h7"],
    },
    {
      kind: "ordered",
      label: "番号付き",
      paths: [
        "M2.6 4.2 3.6 3.5v3",
        "M2.4 9.9a1.1 1.1 0 0 1 2.1.4c0 .9-2.1 1.6-2.1 2.7h2.2",
        "M7 5h6M7 11h6",
      ],
    },
    {
      kind: "checkbox",
      label: "チェックボックス",
      paths: [
        "M3 2.8h10a.7.7 0 0 1 .7.7v9a.7.7 0 0 1-.7.7H3a.7.7 0 0 1-.7-.7v-9a.7.7 0 0 1 .7-.7z",
        "M5 8.2l2.2 2.2L11.2 6",
      ],
    },
    {
      kind: "quote",
      label: "引用",
      paths: ["M3.2 3.8v8.4", "M6.5 5h7M6.5 8h7M6.5 11h4.5"],
    },
  ],
  [
    {
      kind: "link",
      label: "リンク",
      paths: [
        "M6.3 9.7 9.7 6.3",
        "M7.2 4.9 8.6 3.5a2.6 2.6 0 0 1 3.9 3.4l-1.3 1.3",
        "M8.8 11.1 7.4 12.5a2.6 2.6 0 0 1-3.9-3.4l1.3-1.3",
      ],
    },
    {
      // 見出しの行を分ける（本文での見え方に合わせる）
      kind: "table",
      label: "表",
      paths: ["M2.5 3.5h11v9h-11z", "M2.5 6.5h11M6.2 6.5v6M9.8 6.5v6"],
    },
  ],
];
