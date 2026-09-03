// 選択範囲を別のノートに切り出す（TASKS 4-9 / M-1 = 仮身化）。
//
// BTRON の「選択した部分が新しい実身として切り出され、元の場所には仮身が
// 残る」を Markdown に写したもの（参照実装 core/extract.py）。

import { describe, expect, test } from "vitest";
import { extractNote } from "./extract";

describe("extractNote", () => {
  test("題名は本文から決まり、リンクはその題名を指す", () => {
    const found = extractNote("# 会議メモ\n\n本文です。");
    expect(found).toEqual({
      title: "会議メモ",
      text: "# 会議メモ\n\n本文です。",
      link: "[[会議メモ]]",
    });
  });

  test("見出しが無ければ最初の行が題名になり、見出しを足す", () => {
    // **本文から同じ題名が読める**ようにする（読めないと `[[…]]` の先が
    // 行方不明になり、押すと 2 つ目ができる）
    const found = extractNote("予算の話\n\n続き");
    expect(found?.title).toBe("予算の話");
    expect(found?.text).toBe("予算の話\n\n続き");
  });

  test("題名が長ければ切って、見出しを足す", () => {
    const long = "あ".repeat(60);
    const found = extractNote(long);
    expect(found?.title.length).toBeLessThanOrEqual(40);
    // 切ったので本文からは同じ題名が読めない → 見出しを足す
    expect(found?.text.startsWith(`# ${found?.title}\n\n`)).toBe(true);
  });

  test("リンクを壊す記号は題名から落とす", () => {
    // `[` `]` `|` が入るとリンクがそこで切れて別のものを指す
    const found = extractNote("[会議] | メモ\n\n本文");
    expect(found?.title).toBe("会議 メモ");
    expect(found?.link).toBe("[[会議 メモ]]");
  });

  test("同じ題名は避ける（どちらへ飛ぶか決まらなくなる）", () => {
    const found = extractNote("会議メモ\n\n本文", ["会議メモ"]);
    expect(found?.title).toBe("会議メモ 2");
    expect(found?.text.startsWith("# 会議メモ 2\n\n")).toBe(true);
  });

  test("既にある題名は大文字小文字を区別せずに避ける", () => {
    const found = extractNote("Meeting\n\n本文", ["meeting"]);
    expect(found?.title).toBe("Meeting 2");
  });

  test("中身が無ければ切り出さない", () => {
    expect(extractNote("   \n\n  ")).toBeNull();
    expect(extractNote("")).toBeNull();
  });

  test("記号だけの題名は「無題」になる", () => {
    const found = extractNote("[[]]\n\n本文");
    expect(found?.title).toBe("無題");
  });
});
