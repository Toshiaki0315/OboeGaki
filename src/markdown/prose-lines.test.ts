// front matter とコードフェンスの外の行（19-3）。埋め込みの収集・最初の見出し・
// 文体の検査が各自で ``` のトグルを書いていたのを 1 つに

import { describe, expect, it } from "vitest";
import { proseLines } from "./prose-lines";

describe("proseLines", () => {
  it("test_front_matter_とフェンスの中を飛ばし_行頭のオフセットを添える", () => {
    const text = "---\ntitle: x\n---\n# 題\n```\n# コード\n```\n本文";
    expect(proseLines(text)).toEqual([
      { offset: 17, line: "# 題" },
      { offset: 35, line: "本文" },
    ]);
  });

  it("test_チルダのフェンスと字下げしたフェンスも飛ばす", () => {
    const text = "a\n  ~~~\nb\n  ~~~\nc";
    expect(proseLines(text).map((l) => l.line)).toEqual(["a", "c"]);
  });

  it("test_閉じていない_---_は本文（水平線で始まる文書）", () => {
    expect(proseLines("---\n本文").map((l) => l.line)).toEqual(["---", "本文"]);
  });
});
