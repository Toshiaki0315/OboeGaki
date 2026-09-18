// 入力補助（Enter / Tab、spec §5.5）の検証。StateCommand なので DOM 無しで
// 押した結果の文書とカーソルを検査できる。

import { describe, expect, test } from "vitest";
import { continueMarkup, indentListLess, indentListMore } from "./input-assist";
import { press } from "./test-utils";

describe("Enter の入力補助", () => {
  test("箇条書きを継続する", () => {
    expect(press(continueMarkup, "- 項目｜")).toBe("- 項目\n- ｜");
  });

  test("タスクは継続時に必ず未チェックにする", () => {
    expect(press(continueMarkup, "- [x] 済み｜")).toBe("- [x] 済み\n- [ ] ｜");
  });

  test("番号付きは次の番号を振る（以降は振り直さない）", () => {
    expect(press(continueMarkup, "2. 二番目｜\n3. 三番目")).toBe(
      "2. 二番目\n3. ｜\n3. 三番目",
    );
  });

  test("引用を継続する", () => {
    expect(press(continueMarkup, "> 引用｜")).toBe("> 引用\n> ｜");
  });

  test("行の途中の Enter は残りを次の行へ連れて行く", () => {
    expect(press(continueMarkup, "- 前｜後")).toBe("- 前\n- ｜後");
  });

  test("空の項目は改行せず 1 段浅くする（2 段階解除）", () => {
    expect(press(continueMarkup, "  - ｜")).toBe("- ｜");
    expect(press(continueMarkup, "- ｜")).toBe("｜");
  });

  test("空の引用は改行せずマーカーを外す", () => {
    expect(press(continueMarkup, "> ｜")).toBe("｜");
  });

  test("マーカーの内側にカーソルがあるときは何もしない", () => {
    expect(press(continueMarkup, "-｜ 項目")).toBeNull();
  });

  test("段落では何もしない", () => {
    expect(press(continueMarkup, "ただの文｜")).toBeNull();
  });

  test("コードブロックの中は字下げだけを引き継ぐ", () => {
    expect(press(continueMarkup, "```\n    x = 1｜\n```")).toBe(
      "```\n    x = 1\n    ｜\n```",
    );
    // 字下げの途中で改行したときは何もしない
    expect(press(continueMarkup, "```\n  ｜  x = 1\n```")).toBeNull();
    // フェンス内ではリストの補助を発火させない
    expect(press(continueMarkup, "```\n- 項目｜\n```")).toBeNull();
  });
});

describe("Tab の入力補助", () => {
  test("リスト項目を 1 段深くする", () => {
    expect(press(indentListMore, "- 項｜目")).toBe("  - 項｜目");
  });

  test("Shift+Tab はリスト項目を 1 段浅くする", () => {
    expect(press(indentListLess, "  - 項｜目")).toBe("- 項｜目");
    expect(press(indentListLess, "- 項｜目")).toBeNull(); // これ以上浅くならない
  });

  test("番号付きとタスクにも効く", () => {
    expect(press(indentListMore, "1. 番号｜")).toBe("  1. 番号｜");
    expect(press(indentListMore, "- [ ] やる｜")).toBe("  - [ ] やる｜");
  });

  test("リスト行以外では何もしない（通常のタブ挿入に任せる）", () => {
    expect(press(indentListMore, "ただの文｜")).toBeNull();
    expect(press(indentListMore, "```\n- 中身｜\n```")).toBeNull();
  });
});

// 要望 2026-09-17: 番号付きを字下げしたら、入れ子は 1 から数え直し、親は続きから
// （ADR-0066）。Enter の継続は振り直さない（§5.5-3）のはそのまま
describe("番号付きの字下げで番号を振り直す（ADR-0066）", () => {
  const list = "1. あ\n2. か\n3. さ｜\n4. た\n5. な\n6. お";

  test("Tab で入れ子は 1 から、続く親は詰める", () => {
    expect(press(indentListMore, list)).toBe(
      "1. あ\n2. か\n  1. さ｜\n3. た\n4. な\n5. お",
    );
  });

  test("続けて次の行も Tab すると入れ子の 2 になる", () => {
    expect(
      press(indentListMore, "1. あ\n2. か\n  1. さ\n3. た｜\n4. な\n5. お"),
    ).toBe("1. あ\n2. か\n  1. さ\n  2. た｜\n3. な\n4. お");
  });

  test("Shift+Tab で親に戻すと親の続きになり、後ろも詰め直す", () => {
    expect(
      press(indentListLess, "1. あ\n2. か\n  1. さ\n  2. た｜\n3. な\n4. お"),
    ).toBe("1. あ\n2. か\n  1. さ\n3. た｜\n4. な\n5. お");
  });

  test("先頭の番号は保つ（3 から始めたリストは 3 のまま）。`)` も保つ", () => {
    expect(press(indentListMore, "3) a\n4) b｜\n5) c")).toBe(
      "3) a\n  1) b｜\n4) c",
    );
  });

  test("空行で切れた別のリストと、点の箇条書きは触らない", () => {
    expect(press(indentListMore, "1. a\n2. b｜\n\n1. x\n2. y")).toBe(
      "1. a\n  1. b｜\n\n1. x\n2. y",
    );
    // 点の行が間にあると、同じ深さの番号はそこで切れて 1 から
    expect(press(indentListMore, "- 点\n1. a\n2. b｜")).toBe(
      "- 点\n1. a\n  1. b｜",
    );
  });

  test("桁が変わってもカーソルは字に付いていく", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `${i + 1}. 項`).join("\n");
    // 10 行目を字下げ → 入れ子の 1
    const result = press(indentListMore, ten.replace("10. 項", "10. 項｜"));
    expect(result?.split("\n")[9]).toBe("  1. 項｜");
    // 2 行目を字下げ → 3〜10 が 2〜9 に（10. → 9. で桁が減る）
    const shifted = press(indentListMore, ten.replace("2. 項", "2. 項｜"));
    expect(shifted?.split("\n").slice(-2)).toEqual(["8. 項", "9. 項"]);
    expect(shifted?.split("\n")[1]).toBe("  1. 項｜");
  });
});
