// ステータスバーの歯車（参照実装 ui/menus.build_gear_menu と同じ考え方）:
// **メニューバーと同じ動作を使い回し、よく使うものだけ**。全部の写しにすると、
// 探す手間がメニューバーと変わらない。何を並べるかは純関数で決める（19-4）

import { MenuIcon } from "./MenuIcon";
import type { MenuEntry } from "./MenuList";

export type GearMenuFacts = {
  treesVisible: boolean;
  notesVisible: boolean;
  outlineOpen: boolean;
  /// 切ってあるときは項目ごと並べない（押せない項目を見せない）
  assistantEnabled: boolean;
  assistantOpen: boolean;
  sourceMode: boolean;
  wysiwygMode: boolean;
  focus: boolean;
  typewriter: boolean;
};

export type GearMenuActions = {
  onPreferences: () => void;
  onToggleTrees: () => void;
  onToggleNotes: () => void;
  onToggleOutline: () => void;
  onToggleAssistant: () => void;
  onInlineMode: () => void;
  onSourceMode: () => void;
  onPreviewMode: () => void;
  onFocusMode: () => void;
  onTypewriter: () => void;
};

export function gearMenuItems(
  facts: GearMenuFacts,
  act: GearMenuActions,
): MenuEntry[] {
  return [
    {
      label: "環境設定…",
      icon: <MenuIcon name="preferences" />,
      onSelect: act.onPreferences,
    },
    { kind: "separator" },
    {
      label: "サイドバー",
      checked: facts.treesVisible,
      onSelect: act.onToggleTrees,
    },
    {
      label: "ノート一覧",
      checked: facts.notesVisible,
      onSelect: act.onToggleNotes,
    },
    {
      label: "アウトライン",
      checked: facts.outlineOpen,
      onSelect: act.onToggleOutline,
    },
    ...(facts.assistantEnabled
      ? [
          {
            label: "アシスタント",
            checked: facts.assistantOpen,
            onSelect: act.onToggleAssistant,
          } satisfies MenuEntry,
        ]
      : []),
    { kind: "separator" },
    // 編集モード（メニューバーの「編集モード」と同じ並び。ADR-0065）。
    // 上 3 つは排他、下 2 つは併用できる
    {
      label: "インラインモード",
      checked: !facts.sourceMode && !facts.wysiwygMode,
      onSelect: act.onInlineMode,
    },
    {
      label: "ソースモード",
      checked: facts.sourceMode,
      onSelect: act.onSourceMode,
    },
    {
      label: "プレビューモード",
      checked: facts.wysiwygMode,
      onSelect: act.onPreviewMode,
    },
    { kind: "separator" },
    {
      label: "フォーカスモード",
      checked: facts.focus,
      onSelect: act.onFocusMode,
    },
    {
      label: "タイプライターモード",
      checked: facts.typewriter,
      onSelect: act.onTypewriter,
    },
  ];
}
