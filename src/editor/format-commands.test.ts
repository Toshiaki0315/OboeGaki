// 書式トグル（spec §5.4）の検証。分岐が本体なのでここで網羅する。

import { describe, expect, test } from "vitest";
import {
  insertLink,
  shiftHeading,
  toggleCheckbox,
  toggleWrap,
  cycleHeading,
  toggleBullet,
  toggleOrdered,
  toggleQuote,
} from "./format-commands";

describe("toggleWrap", () => {
  test("選択が無ければ記号だけ置いて間にキャレットを入れる", () => {
    expect(toggleWrap("あい", 1, 1, "**")).toEqual({
      start: 1,
      end: 1,
      text: "****",
      selectStart: 3,
      selectEnd: 3,
    });
  });

  test("選択範囲を囲む", () => {
    const text = "これは強調です";
    expect(toggleWrap(text, 3, 5, "**")).toEqual({
      start: 3,
      end: 5,
      text: "**強調**",
      selectStart: 5,
      selectEnd: 7,
    });
  });

  test("マーカーが選択の外側にあれば外す（中身だけ選んだ状態）", () => {
    const text = "これは**強調**です";
    expect(toggleWrap(text, 5, 7, "**")).toEqual({
      start: 3,
      end: 9,
      text: "強調",
      selectStart: 3,
      selectEnd: 5,
    });
  });

  test("マーカーごと選んでいれば外す", () => {
    const text = "これは**強調**です";
    expect(toggleWrap(text, 3, 9, "**")).toEqual({
      start: 3,
      end: 9,
      text: "強調",
      selectStart: 3,
      selectEnd: 5,
    });
  });

  test("1 文字マーカー（斜体・コード）でも同じに動く", () => {
    expect(toggleWrap("あ`コード`い", 2, 5, "`")).toEqual({
      start: 1,
      end: 6,
      text: "コード",
      selectStart: 1,
      selectEnd: 4,
    });
    expect(toggleWrap("斜体", 0, 2, "*")).toEqual({
      start: 0,
      end: 2,
      text: "*斜体*",
      selectStart: 1,
      selectEnd: 3,
    });
  });

  test("ハイライトの :: も囲める", () => {
    expect(toggleWrap("目立つ", 0, 3, "::")).toEqual({
      start: 0,
      end: 3,
      text: "::目立つ::",
      selectStart: 2,
      selectEnd: 5,
    });
  });
});

describe("insertLink", () => {
  test("URL が空なら () の中にキャレットを置く", () => {
    const text = "詳細はここを見よ";
    const caret = 3 + "[ここ](".length;
    expect(insertLink(text, 3, 5, "")).toEqual({
      start: 3,
      end: 5,
      text: "[ここ]()",
      selectStart: caret,
      selectEnd: caret,
    });
  });

  test("URL があればリンク全体の後ろにキャレット", () => {
    const body = "[ここ](https://x.com)";
    expect(insertLink("ここ", 0, 2, "https://x.com")).toEqual({
      start: 0,
      end: 2,
      text: body,
      selectStart: body.length,
      selectEnd: body.length,
    });
  });

  test("選択が無ければ空の雛形を置いて () の中へ", () => {
    const caret = 1 + "[](".length;
    expect(insertLink("あい", 1, 1, "")).toEqual({
      start: 1,
      end: 1,
      text: "[]()",
      selectStart: caret,
      selectEnd: caret,
    });
  });
});

describe("shiftHeading", () => {
  test("下げると # が増え、段落は見出しになる", () => {
    expect(shiftHeading("# 題", 1)).toBe("## 題");
    expect(shiftHeading("段落", 1)).toBe("# 段落");
  });

  test("上げると # が減り、H1 は段落へ戻る", () => {
    expect(shiftHeading("## 題", -1)).toBe("# 題");
    expect(shiftHeading("# 題", -1)).toBe("題");
  });

  test("範囲外は変化しない（None 相当）", () => {
    expect(shiftHeading("段落", -1)).toBeNull();
    expect(shiftHeading("###### 題", 1)).toBeNull();
  });
});

describe("toggleCheckbox", () => {
  test("タスク項目は [ ] と [x] を往復する", () => {
    expect(toggleCheckbox("- [ ] やる", "list")).toBe("- [x] やる");
    expect(toggleCheckbox("- [x] 済み", "list")).toBe("- [ ] 済み");
  });

  test("ただのリスト項目にはチェックボックスを付ける", () => {
    expect(toggleCheckbox("- 項目", "list")).toBe("- [ ] 項目");
    expect(toggleCheckbox("  3. 番号", "list")).toBe("  3. [ ] 番号");
  });

  test("ただの行はリスト項目に変えたうえで付ける", () => {
    expect(toggleCheckbox("ただの文", "paragraph")).toBe("- [ ] ただの文");
  });

  test("見出しとコードはタスクにしない（事故防止）", () => {
    expect(toggleCheckbox("# 見出し", "heading")).toBeNull();
    expect(toggleCheckbox("const a = 1;", "code")).toBeNull();
  });
});

describe("cycleHeading", () => {
  test.each([
    ["段落はH1に", "本文", "# 本文"],
    ["H1はH2に", "# 本文", "## 本文"],
    ["H2はH3に", "## 本文", "### 本文"],
    ["H3は段落に戻る", "### 本文", "本文"],
    ["手打ちのH4は段落に戻す", "#### 本文", "本文"],
  ])("test_%s", (_label, line, expected) => {
    expect(cycleHeading(line)).toBe(expected);
  });
});

describe("行単位のトグル（共通の約束）", () => {
  test("test_全部付いていれば外す", () => {
    expect(toggleBullet(["- a", "- b"])).toEqual(["a", "b"]);
    expect(toggleOrdered(["1. a", "2. b"])).toEqual(["a", "b"]);
    expect(toggleQuote(["> a", "> b"])).toEqual(["a", "b"]);
  });

  test("test_一部だけなら揃える", () => {
    expect(toggleBullet(["- a", "b"])).toEqual(["- a", "- b"]);
    expect(toggleQuote(["> a", "b"])).toEqual(["> a", "> b"]);
  });

  test("test_付けるときは字下げを保つ", () => {
    expect(toggleBullet(["  a"])).toEqual(["  - a"]);
    // 外すときは記号もろとも字下げも外れる（参照実装の実出力）
    expect(toggleBullet(["  - a"])).toEqual(["a"]);
  });
});

describe("toggleBullet / toggleOrdered", () => {
  test("test_空行は触らない", () => {
    expect(toggleBullet(["a", "", "b"])).toEqual(["- a", "", "- b"]);
  });

  test("test_空行しか無ければ付ける", () => {
    // 「これから書く」という意思。何も起きないほうが困る
    expect(toggleBullet([""])).toEqual(["- "]);
  });

  test("test_番号付きからは乗り換える", () => {
    expect(toggleBullet(["1. a", "2. b"])).toEqual(["- a", "- b"]);
    expect(toggleOrdered(["- a", "- b"])).toEqual(["1. a", "2. b"]);
  });

  test("test_番号は1から振り直す", () => {
    expect(toggleOrdered(["5. a", "9. b", "c"])).toEqual([
      "1. a",
      "2. b",
      "3. c",
    ]);
  });

  test("test_チェックボックスは記号の一部として扱わない", () => {
    // `- [ ] 買う` から `- ` だけ外すと `[ ] 買う` が残る。残すのが正しい
    expect(toggleBullet(["- [ ] 買う"])).toEqual(["[ ] 買う"]);
  });
});

describe("toggleQuote", () => {
  test("test_空行も引用にする", () => {
    // 空行が引用から抜けると、そこで引用が途切れて別々になる
    expect(toggleQuote(["a", "", "b"])).toEqual(["> a", "> ", "> b"]);
  });

  test("test_付いているかの判定に空行は入れない", () => {
    expect(toggleQuote(["> a", "", "> b"])).toEqual(["a", "", "b"]);
  });

  test("test_入れ子は作らない", () => {
    expect(toggleQuote(["> a", "b"])).toEqual(["> a", "> b"]);
  });
});
