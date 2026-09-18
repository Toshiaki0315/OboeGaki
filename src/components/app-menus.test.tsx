// 本文・歯車・サイドバーの右クリックに並ぶもの（19-4 で App.tsx から切り出した）。
// **判断だけを見る** — 描くのは MenuList、押したときに何が起きるかは App

import { describe, expect, test, vi } from "vitest";
import { AI_HANDOFFS } from "../lib/handoff";
import { editorMenuItems, type EditorMenuActions } from "./editor-menu";
import { gearMenuItems, type GearMenuActions } from "./gear-menu";
import type { MenuEntry } from "./MenuList";
import { outlineMenuItems, tagMenuItems } from "./side-menus";

const find = (items: MenuEntry[], label: string) =>
  items.find((entry) => "label" in entry && entry.label === label);
const labels = (items: MenuEntry[]) =>
  items.flatMap((entry) => ("label" in entry ? [entry.label] : []));

describe("editorMenuItems", () => {
  const act = (): EditorMenuActions => ({
    onClipboard: vi.fn(),
    onFormat: vi.fn(),
    onInsertTable: vi.fn(),
    onHandOff: vi.fn(),
    onDictionary: vi.fn(),
  });

  test("test_選んでいないと_切り取り_コピー_渡す道_辞書は押せない_貼り付けは押せる", () => {
    const items = editorMenuItems({ selected: false }, act());
    for (const label of [
      "切り取り",
      "コピー",
      "生成AIに渡す",
      "辞書で調べる",
    ]) {
      expect(find(items, label)).toMatchObject({ disabled: true });
    }
    expect(find(items, "貼り付け")).not.toHaveProperty("disabled", true);
  });

  test("test_選んでいれば生成AIは枝になり_中に_4_つ並ぶ", () => {
    const items = editorMenuItems({ selected: true }, act());
    const ai = find(items, "生成AIに渡す");
    expect(ai).toMatchObject({ kind: "submenu" });
    expect(
      (ai as { items: MenuEntry[] }).items.map((e) => "label" in e && e.label),
    ).toEqual(AI_HANDOFFS.map((h) => h.name));
  });

  test("test_書式はツールバーと同じ種類を呼ぶ", () => {
    const a = act();
    const items = editorMenuItems({ selected: true }, a);
    (find(items, "太字") as { onSelect: () => void }).onSelect();
    expect(a.onFormat).toHaveBeenCalledWith("strong");
  });
});

describe("gearMenuItems", () => {
  const facts = {
    treesVisible: true,
    notesVisible: false,
    outlineOpen: true,
    assistantEnabled: false,
    assistantOpen: false,
    sourceMode: false,
    wysiwygMode: true,
    focus: false,
    typewriter: true,
  };
  const act = (): GearMenuActions => ({
    onPreferences: vi.fn(),
    onToggleTrees: vi.fn(),
    onToggleNotes: vi.fn(),
    onToggleOutline: vi.fn(),
    onToggleAssistant: vi.fn(),
    onInlineMode: vi.fn(),
    onSourceMode: vi.fn(),
    onPreviewMode: vi.fn(),
    onFocusMode: vi.fn(),
    onTypewriter: vi.fn(),
  });

  test("test_印は今の状態を映し_編集モードは_3_つで_1_つだけ", () => {
    const items = gearMenuItems(facts, act());
    expect(find(items, "サイドバー")).toMatchObject({ checked: true });
    expect(find(items, "ノート一覧")).toMatchObject({ checked: false });
    expect(find(items, "インラインモード")).toMatchObject({ checked: false });
    expect(find(items, "ソースモード")).toMatchObject({ checked: false });
    expect(find(items, "プレビューモード")).toMatchObject({ checked: true });
    expect(find(items, "タイプライターモード")).toMatchObject({
      checked: true,
    });
  });

  test("test_アシスタントを切ってあれば項目ごと並べない", () => {
    expect(labels(gearMenuItems(facts, act()))).not.toContain("アシスタント");
    expect(
      labels(gearMenuItems({ ...facts, assistantEnabled: true }, act())),
    ).toContain("アシスタント");
  });
});

describe("tagMenuItems / outlineMenuItems", () => {
  test("test_絞り込み中は解除_でなければそのタグで絞る", () => {
    const onFilter = vi.fn();
    const act = {
      onFilter,
      onSearch: vi.fn(),
      onCopy: vi.fn(),
      onRename: vi.fn(),
    };
    const on = tagMenuItems({ tag: "a", filtered: true }, act);
    expect(labels(on)[0]).toBe("絞り込みを解除");
    (on[0] as { onSelect: () => void }).onSelect();
    expect(onFilter).toHaveBeenCalledWith(null);
    const off = tagMenuItems({ tag: "a", filtered: false }, act);
    expect(labels(off)[0]).toBe("#a で絞り込む");
    (off[0] as { onSelect: () => void }).onSelect();
    expect(onFilter).toHaveBeenCalledWith("a");
  });

  test("test_目次の節は上と下の_2_つ", () => {
    const onMove = vi.fn();
    const items = outlineMenuItems({ onMove });
    expect(labels(items)).toEqual(["この節を上へ動かす", "この節を下へ動かす"]);
    (items[1] as { onSelect: () => void }).onSelect();
    expect(onMove).toHaveBeenCalledWith(1);
  });
});
