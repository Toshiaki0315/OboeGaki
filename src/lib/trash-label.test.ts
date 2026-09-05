// ゴミ箱の行の見せ方（要望 2026-09-04: もう少し見やすく）。
// 題名を主にして、フォルダは添えに回す。

import { describe, expect, it } from "vitest";
import { folderFilterLabel, trashLabel, trashParts } from "./trash-label";

const root = "/v/notes";

describe("trashParts", () => {
  it("test_直下のノートは題名だけ", () => {
    expect(trashParts(root, `${root}/.trash/買い物.md`)).toEqual({
      name: "買い物",
      folder: "",
    });
  });

  it("test_フォルダの中なら題名とフォルダに分ける", () => {
    expect(trashParts(root, `${root}/.trash/仕事/議事録.md`)).toEqual({
      name: "議事録",
      folder: "仕事",
    });
  });

  it("test_入れ子のフォルダはそのまま添える", () => {
    expect(trashParts(root, `${root}/.trash/a/b/c.markdown`)).toEqual({
      name: "c",
      folder: "a/b",
    });
  });

  it("test_ゴミ箱の外の形でも落ちない", () => {
    // 想定外の入力でも題名は出す（一覧が空白になるほうが困る）
    expect(trashParts(root, "/どこか/別.md")).toEqual({
      name: "別",
      folder: "/どこか",
    });
  });
});

describe("trashLabel", () => {
  it("test_確認の文には元の位置ごと出す（どれを消すのか分かる）", () => {
    expect(trashLabel(root, `${root}/.trash/仕事/議事録.md`)).toBe(
      "仕事/議事録",
    );
  });
});

describe("folderFilterLabel", () => {
  it("test_ゴミ箱は記号ではなく呼び名で出す（要望 2026-09-05）", () => {
    // 一覧の帯に `.trash` と出ると、隠しフォルダを開いたように見える
    expect(folderFilterLabel(".trash")).toBe("ゴミ箱");
  });

  it("test_空文字は直下", () => {
    expect(folderFilterLabel("")).toBe("直下");
  });

  it("test_そのほかはフォルダの道をそのまま", () => {
    expect(folderFilterLabel("仕事/2026")).toBe("仕事/2026");
  });
});
