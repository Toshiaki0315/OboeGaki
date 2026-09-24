// 行内の装飾を Run 列にする（ADR-0068 / 19-5）。Word 書き出しが自前の style stack
// で TextRun を組んでいたのを、スライドと同じ Run（markdown/runs）に寄せる。
// 解析は HTML と同じ markdown-it（export-html の markdownTokens）

import { describe, expect, test } from "vitest";
import { markdownTokens } from "./export-html";
import { inlinePieces } from "./export-runs";

function pieces(markdown: string) {
  const inline = markdownTokens(markdown).find((t) => t.type === "inline");
  if (!inline) throw new Error("inline が無い");
  return inlinePieces(inline);
}

describe("inlinePieces", () => {
  test("test_行内脚注の番号は脚注側と同じ_1_始まり（21-3）", () => {
    // ^[…] は label を持たず id は 0 始まり。本文は [0]、脚注側は id+1 で [1] と
    // ずれていた（レビュー 2026-09-24）
    expect(pieces("a^[注] b")).toEqual([
      { kind: "run", run: { text: "a" } },
      { kind: "run", run: { text: "[1]" } },
      { kind: "run", run: { text: " b" } },
    ]);
  });

  test("test_太字_斜体_打ち消し_コード_リンク_色を_Run_に写す", () => {
    expect(
      pieces(
        '**太**と*斜*と~~消~~と`c`と[L](https://x.com)と<span style="color:#ff0000">赤</span>',
      ),
    ).toEqual([
      { kind: "run", run: { text: "太", bold: true } },
      { kind: "run", run: { text: "と" } },
      { kind: "run", run: { text: "斜", italic: true } },
      { kind: "run", run: { text: "と" } },
      { kind: "run", run: { text: "消", strike: true } },
      { kind: "run", run: { text: "と" } },
      { kind: "run", run: { text: "c", code: true } },
      { kind: "run", run: { text: "と" } },
      { kind: "run", run: { text: "L", link: "https://x.com" } },
      { kind: "run", run: { text: "と" } },
      { kind: "run", run: { text: "赤", color: "FF0000" } },
    ]);
  });

  test("test_入れ子は装飾を重ね_閉じると戻る", () => {
    expect(pieces("**太*太斜*太**")).toEqual([
      { kind: "run", run: { text: "太", bold: true } },
      { kind: "run", run: { text: "太斜", bold: true, italic: true } },
      { kind: "run", run: { text: "太", bold: true } },
    ]);
  });

  test("test_やることの印と改行と画像は_run_でない断片に", () => {
    const found = pieces("- [x] 済み  \n![説明|120](a.png)");
    expect(found[0]).toEqual({ kind: "run", run: { text: "☑ " } });
    expect(found).toContainEqual({ kind: "break" });
    expect(found).toContainEqual({
      kind: "image",
      src: "a.png",
      alt: "説明",
      width: 120,
    });
  });
});
