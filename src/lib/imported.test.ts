// 取り込んだ文字を Markdown に整える（TASKS 4-6 / F-1）。
// 判断の物差しは「間違えたときにどちらが困るか」。迷ったら残す。

import { describe, expect, test } from "vitest";
import { toMarkdown } from "./imported";

describe("toMarkdown", () => {
  test("ページの頭が見出しらしければ `##` にする", () => {
    // 資料は 1 ページ = 1 枚のことが多く、先頭行が題である
    const md = toMarkdown(["背景と目的\nここから本文が始まります。"], "資料");
    expect(md).toContain("# 資料");
    expect(md).toContain("## 背景と目的");
    expect(md).toContain("ここから本文が始まります。");
  });

  test("折り返された行を 1 つの段落に戻す（和文は詰めて繋ぐ）", () => {
    // PDF は幅で折り返すので、途中の行は端まで伸び、最後の行だけ短い
    // 1 行目は見出しの長さ（30 字）を超えるので本文として扱われる
    const page = [
      "これは長い段落の一行目で、ページの右端いっぱいまで文字が伸びている行です",
      "そして二行目もページの右端いっぱいまで文字が伸びているところの行です",
      "最後の行。",
    ].join("\n");
    const md = toMarkdown([page]);
    expect(md).toContain(
      "これは長い段落の一行目で、ページの右端いっぱいまで文字が伸びている行ですそして二行目もページの右端いっぱいまで文字が伸びているところの行です最後の行。",
    );
  });

  test("欧文は空白で繋ぐ", () => {
    const page = [
      "This is a long paragraph that reaches the right edge of",
      "the page and continues here.",
    ].join("\n");
    expect(toMarkdown([page])).toContain("edge of the page");
  });

  test("行頭記号は箇条書きにする", () => {
    const md = toMarkdown(["・一つ目\n・二つ目"]);
    expect(md).toContain("- 一つ目\n- 二つ目");
  });

  test("ページ番号だけの行は落とす", () => {
    const md = toMarkdown(["本文です。\n- 3 -"]);
    expect(md).not.toContain("- 3 -");
    expect(md).toContain("本文です。");
  });

  test("**迷ったら残す**（年や見出し番号は消さない）", () => {
    expect(toMarkdown(["2026\n本文です。"])).toContain("2026");
  });

  test("ページごとに区切って繋ぐ", () => {
    const md = toMarkdown(["一枚目の題\n本文です。", "二枚目の題\n本文です。"]);
    expect(md).toContain("## 一枚目の題");
    expect(md).toContain("## 二枚目の題");
  });

  test("中身が無ければ空（題名だけのノートを作らせない）", () => {
    expect(toMarkdown([], "資料")).toBe("");
    expect(toMarkdown(["", "  "], "資料")).toBe("");
  });

  test("制御文字（改ページなど）は落とす", () => {
    expect(toMarkdown(["本文です。\f"])).not.toContain("\f");
  });
});
