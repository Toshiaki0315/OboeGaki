// ノート一覧の並び順（C-3 相当）。

import { describe, expect, test } from "vitest";
import { formatStamp, sortNotes, type NoteEntry } from "./note-order";

const entry = (label: string, mtimeMs: number): NoteEntry => ({
  path: `/v/${label}.md`,
  label,
  preview: "",
  mtimeMs,
  pinned: false,
});

describe("sortNotes", () => {
  const notes = [
    entry("あとで", 100),
    entry("いちばん新しい", 300),
    entry("まんなか", 200),
  ];

  test("更新順は新しいものが先", () => {
    expect(sortNotes(notes, "modified").map((n) => n.label)).toEqual([
      "いちばん新しい",
      "まんなか",
      "あとで",
    ]);
  });

  test("名前順は五十音・辞書順", () => {
    expect(sortNotes(notes, "title").map((n) => n.label)).toEqual([
      "あとで",
      "いちばん新しい",
      "まんなか",
    ]);
  });

  test("元の配列を壊さない", () => {
    const before = notes.map((n) => n.label);
    sortNotes(notes, "modified");
    expect(notes.map((n) => n.label)).toEqual(before);
  });

  test("更新順の同時刻は名前で安定させる", () => {
    const same = [entry("に", 100), entry("あ", 100)];
    expect(sortNotes(same, "modified").map((n) => n.label)).toEqual([
      "あ",
      "に",
    ]);
  });
});

describe("formatStamp", () => {
  test("YYYY-MM-DD HH:MM の形で返す", () => {
    expect(formatStamp(Date.UTC(2026, 8, 4, 3, 5))).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });
});

describe("ピン留めの先頭固定", () => {
  const entry = (
    label: string,
    mtimeMs: number,
    pinned: boolean,
  ): NoteEntry => ({
    path: `/v/${label}.md`,
    label,
    preview: "",
    mtimeMs,
    pinned,
  });

  test("test_ピン留めはどの並び順でも先頭に来る", () => {
    const notes = [
      entry("新しい", 300, false),
      entry("留めた古い", 100, true),
      entry("あ", 200, false),
    ];
    expect(sortNotes(notes, "modified").map((n) => n.label)).toEqual([
      "留めた古い",
      "新しい",
      "あ",
    ]);
    expect(sortNotes(notes, "title").map((n) => n.label)).toEqual([
      "留めた古い",
      "あ",
      "新しい",
    ]);
  });

  test("test_ピン留め同士は選んだ並び順に従う", () => {
    const notes = [
      entry("bピン", 100, true),
      entry("aピン", 200, true),
      entry("普通", 300, false),
    ];
    expect(sortNotes(notes, "modified").map((n) => n.label)).toEqual([
      "aピン",
      "bピン",
      "普通",
    ]);
    expect(sortNotes(notes, "title").map((n) => n.label)).toEqual([
      "aピン",
      "bピン",
      "普通",
    ]);
  });
});
