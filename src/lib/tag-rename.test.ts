import { describe, expect, test } from "vitest";
import { tagRenamePlan } from "./tag-rename";

// タグの改名・統合（ADR-0055 / 12-4）。押す前に何が起きるかを言葉にする
describe("tagRenamePlan", () => {
  const tags = ["会議", "ミーティング", "work/会議"];
  test("test_無い名前なら改名_ある名前なら統合", () => {
    expect(tagRenamePlan(tags, "会議", "打合せ")).toEqual({
      kind: "rename",
      to: "打合せ",
    });
    expect(tagRenamePlan(tags, "会議", "ミーティング")).toEqual({
      kind: "merge",
      to: "ミーティング",
    });
  });
  test("test_前後の空白と先頭の # は落とし_同じ名前や空や空白入りは断る", () => {
    expect(tagRenamePlan(tags, "会議", " #打合せ ")).toEqual({
      kind: "rename",
      to: "打合せ",
    });
    expect(tagRenamePlan(tags, "会議", "会議")).toEqual({ kind: "same" });
    expect(tagRenamePlan(tags, "会議", "")).toEqual({ kind: "invalid" });
    expect(tagRenamePlan(tags, "会議", "打 合せ")).toEqual({ kind: "invalid" });
    expect(tagRenamePlan(tags, "会議", "a#b")).toEqual({ kind: "invalid" });
  });
  test("test_大小の違いだけなら統合ではなく改名として扱う（索引は小文字で持つ）", () => {
    expect(tagRenamePlan(["work"], "work", "Work")).toEqual({ kind: "same" });
  });
});
