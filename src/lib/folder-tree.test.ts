// 「直下」の行を見出しに畳む（要望 2026-09-05）。

import { describe, expect, it } from "vitest";
import { TRASH_FOLDER } from "./finder";
import {
  folderDepth,
  folderLabel,
  hasSubfolders,
  newNoteFolder,
  splitFolders,
  visibleFolders,
} from "./folder-tree";

const folders = [
  { folder: "", count: 12 },
  { folder: "Qiita", count: 1 },
  { folder: "仕事", count: 0 },
];

describe("splitFolders", () => {
  it("test_直下の件数は見出しに回す", () => {
    expect(splitFolders(folders).root).toBe(12);
  });

  it("test_木に並べるのは中のフォルダだけ", () => {
    expect(splitFolders(folders).sub.map((entry) => entry.folder)).toEqual([
      "Qiita",
      "仕事",
    ]);
  });

  it("test_直下が無い一覧でも 0 で答える", () => {
    // 索引がまだ空のとき（開いた直後）に落ちない
    expect(splitFolders([])).toEqual({ root: 0, sub: [] });
  });
});

describe("folderLabel / folderDepth", () => {
  it("test_直下は「直下」_あとは末端の名前", () => {
    expect(folderLabel("")).toBe("直下");
    expect(folderLabel("仕事/会議")).toBe("会議");
  });
  it("test_深さは直下が 0", () => {
    expect(folderDepth("")).toBe(0);
    expect(folderDepth("仕事/会議")).toBe(2);
  });
});

describe("newNoteFolder", () => {
  it("test_絞っていなければ直下", () => {
    expect(newNoteFolder(null)).toBe("");
  });
  it("test_フォルダで絞っていればその中（要望 2026-09-07）", () => {
    expect(newNoteFolder("仕事")).toBe("仕事");
    expect(newNoteFolder("仕事/会議")).toBe("仕事/会議");
  });
  it("test_直下で絞っていれば直下", () => {
    expect(newNoteFolder("")).toBe("");
  });
  it("test_ゴミ箱を見ているときは直下（ゴミ箱の中には作らない）", () => {
    expect(newNoteFolder(TRASH_FOLDER)).toBe("");
  });
});

describe("サブフォルダを畳む（要望 2026-09-08）", () => {
  const folders = [
    { folder: "仕事", count: 3 },
    { folder: "仕事/会議", count: 1 },
    { folder: "仕事/会議/2026", count: 2 },
    { folder: "私用", count: 0 },
  ];
  it("test_hasSubfolders は直下でも孫でも子がいれば真", () => {
    expect(hasSubfolders("仕事", folders)).toBe(true);
    expect(hasSubfolders("仕事/会議", folders)).toBe(true);
    expect(hasSubfolders("仕事/会議/2026", folders)).toBe(false);
    expect(hasSubfolders("私用", folders)).toBe(false);
    // 「仕事」を畳んでも「仕事場」は隠さない（前方一致ではなく区切りで見る）
    expect(hasSubfolders("仕", folders)).toBe(false);
  });
  it("test_visibleFolders は畳んだフォルダの中身を隠す（本人は残る）", () => {
    expect(
      visibleFolders(folders, new Set(["仕事"])).map((f) => f.folder),
    ).toEqual(["仕事", "私用"]);
    expect(
      visibleFolders(folders, new Set(["仕事/会議"])).map((f) => f.folder),
    ).toEqual(["仕事", "仕事/会議", "私用"]);
    expect(
      visibleFolders(folders, new Set()).map((f) => f.folder),
    ).toHaveLength(4);
  });
});
