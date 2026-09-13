// 覗き見の泡（U-2）の中身づくり。参照実装 editor/link_preview.py の excerpt
// と同じ規則（front matter を外す・題名の行は 1 行だけ落とす・行数と字数で切る）。

import { describe, expect, test } from "vitest";
import { PEEK_CHARS, PEEK_LINES, peekExcerpt } from "./note-peek";

describe("peekExcerpt", () => {
  test("test_front_matter は出さない（泡が YAML で埋まらない）", () => {
    const text =
      "---\ncreated: 2026-09-13\nid: 01M14\n---\n\n# 題\n\n本文です\n";
    expect(peekExcerpt(text)).toBe("本文です");
  });

  test("test_題名の行は落とす（泡の見出しと重なる）", () => {
    expect(peekExcerpt("# 会議メモ\n\n決めたこと\n")).toBe("決めたこと");
  });

  test("test_落とすのは題名の行（H1）だけ_一覧のプレビューと同じ規則", () => {
    // Rust の note_preview（一覧の冒頭）は `# ` だけを落とす。ここが
    // 「見出しなら何でも落とす」だと、同じノートで**泡と一覧の中身が
    // 食い違う**（レビュー 2026-09-13 / 15-6）
    expect(peekExcerpt("## 節から始まるノート\n\n本文\n")).toBe(
      "## 節から始まるノート\n本文",
    );
  });

  test("test_落とすのは最初の 1 行だけ（骨組みだけのノートが空にならない）", () => {
    // ここで門を開けたままにすると `## 節` まで捨て、「まだ無いノート」に見える
    expect(peekExcerpt("# 題\n\n## 節\n\n## 別の節\n")).toBe(
      "## 節\n## 別の節",
    );
  });

  test("test_記号は落とさない（箇条書きかコードか分からなくなる）", () => {
    expect(peekExcerpt("# 題\n\n- 一つ目\n- 二つ目\n")).toBe(
      "- 一つ目\n- 二つ目",
    );
  });

  test("test_空行は詰めて_行数で切る", () => {
    const text =
      "# 題\n" + Array.from({ length: 20 }, (_, i) => `\n行 ${i}`).join("");
    expect(peekExcerpt(text).split("\n")).toHaveLength(PEEK_LINES);
  });

  test("test_長すぎるときは字数で切って印を付ける", () => {
    const long = "あ".repeat(PEEK_CHARS * 2);
    const found = peekExcerpt(`# 題\n\n${long}\n`);
    expect(found.endsWith("…")).toBe(true);
    expect(found.length).toBe(PEEK_CHARS + 1);
  });

  test("test_空のノートは空を返す（呼ぶ側が泡を出さない）", () => {
    expect(peekExcerpt("# 題だけ\n")).toBe("");
    expect(peekExcerpt("")).toBe("");
  });
});
