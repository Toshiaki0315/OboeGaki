// 本文の右クリック（要望 2026-09-04）。切り取り・コピー・貼り付け、書式、表、
// そして**外へ出る道**（生成 AI・検索・辞書）。何を並べるかは純関数で決める
// （note-menu と同じ構え）。App.tsx の JSX に 100 行埋まっていた（19-4）

import type { FormatKind } from "../editor/format-commands";
import { FORMAT_TOOLBAR } from "../editor/format-toolbar";
import { AI_HANDOFFS, SEARCH_HANDOFF, type Handoff } from "../lib/handoff";
import { MenuIcon, PathIcon } from "./MenuIcon";
import type { MenuEntry } from "./MenuList";

export type EditorMenuFacts = {
  /// 文字を選んでいるか（選んでいないと切り取り・コピー・渡す道は押せない）
  selected: boolean;
};

export type EditorMenuActions = {
  onClipboard: (action: "cut" | "copy" | "paste") => void;
  onFormat: (kind: FormatKind) => void;
  onInsertTable: () => void;
  onHandOff: (handoff: Handoff) => void;
  onDictionary: () => void;
};

/// 書式の絵は**ツールバーと同じもの**を引く（同じ言葉に同じ絵）
function formatEntry(
  kind: FormatKind,
  label: string,
  act: EditorMenuActions,
): MenuEntry {
  return {
    label,
    icon: (
      <PathIcon
        className="menu-icon"
        paths={
          FORMAT_TOOLBAR.flat().find((found) => found.kind === kind)?.paths ??
          []
        }
        strokeWidth={1.3}
      />
    ),
    onSelect: () => act.onFormat(kind),
  };
}

export function editorMenuItems(
  { selected }: EditorMenuFacts,
  act: EditorMenuActions,
): MenuEntry[] {
  const handoffIcon = <MenuIcon name="handoff" />;
  return [
    // 選んでいないときは押せない状態で見せる
    // （項目ごと消すと、なぜ無いのか分からない）
    {
      label: "切り取り",
      icon: <MenuIcon name="cut" />,
      disabled: !selected,
      onSelect: () => act.onClipboard("cut"),
    },
    {
      label: "コピー",
      icon: <MenuIcon name="copy" />,
      disabled: !selected,
      onSelect: () => act.onClipboard("copy"),
    },
    {
      label: "貼り付け",
      icon: <MenuIcon name="paste" />,
      onSelect: () => act.onClipboard("paste"),
    },
    { kind: "separator" },
    formatEntry("strong", "太字", act),
    formatEntry("emphasis", "斜体", act),
    formatEntry("code", "コード", act),
    formatEntry("link", "リンク", act),
    { kind: "separator" },
    formatEntry("heading", "見出し", act),
    formatEntry("bullet", "箇条書き", act),
    formatEntry("quote", "引用", act),
    { kind: "separator" },
    {
      label: "表を挿入…",
      icon: <MenuIcon name="table" />,
      onSelect: act.onInsertTable,
    },
    { kind: "separator" },
    // **外へ出る道**（要望 2026-09-05）。生成 AI は 4 つを枝にまとめる —
    // 平らに並べるとメニューの半分を占める。選んでいないときは押せない状態で
    // 見せる（渡すものが無い）
    selected
      ? {
          kind: "submenu",
          label: "生成AIに渡す",
          icon: handoffIcon,
          items: AI_HANDOFFS.map((handoff) => ({
            label: handoff.name,
            onSelect: () => act.onHandOff(handoff),
          })),
        }
      : {
          label: "生成AIに渡す",
          icon: handoffIcon,
          disabled: true,
          onSelect: () => {},
        },
    {
      label: SEARCH_HANDOFF.label,
      icon: <MenuIcon name="search" />,
      disabled: !selected,
      onSelect: () => act.onHandOff(SEARCH_HANDOFF),
    },
    // 手元の辞書（7-2。ポメラの電子辞書相当）。**外へ出ない**ので、生成 AI の
    // ような確認は挟まない
    {
      label: "辞書で調べる",
      icon: <MenuIcon name="dictionary" />,
      disabled: !selected,
      onSelect: act.onDictionary,
    },
  ];
}
