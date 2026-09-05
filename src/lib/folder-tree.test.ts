// 「直下」の行を見出しに畳む（要望 2026-09-05）。

import { describe, expect, it } from "vitest";
import { splitFolders } from "./folder-tree";

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
