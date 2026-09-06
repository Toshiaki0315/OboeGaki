// 情報密度で枚を割る（TASKS 8-5 / CFG-41 / 42 / 43 / 46）。

import { describe, expect, it } from "vitest";
import { splitDeck } from "./slides";
import { slideMetrics } from "./slide-grid";
import { DEFAULT_PPTX_SETTINGS, type PptxSettings } from "./pptx-settings";
import { splitForDensity } from "./slide-split";
import { overflowingSlides } from "./slide-lint";

const settings = (
  patch: Partial<PptxSettings["layout"]> = {},
): PptxSettings => ({
  ...DEFAULT_PPTX_SETTINGS,
  layout: { ...DEFAULT_PPTX_SETTINGS.layout, ...patch },
});

const run = (markdown: string, config = settings()) =>
  splitForDensity(splitDeck(markdown), config, slideMetrics(config));

describe("CFG-42 箇条書きの上限", () => {
  const many = (count: number) =>
    `## A\n\n${Array.from({ length: count }, (_, i) => `- 項目${i + 1}`).join("\n")}\n`;

  it("test_上限までなら 1 枚のまま", () => {
    expect(run(many(6)).slides).toHaveLength(1);
  });

  it("test_超えたら次の枚へ送る", () => {
    const deck = run(many(7));
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].blocks).toHaveLength(6);
    expect(deck.slides[1].blocks).toHaveLength(1);
  });

  it("test_続きの枚には印を付ける（CFG-43）", () => {
    expect(run(many(7)).slides[1].title).toBe("A（続き）");
  });

  it("test_印は設定で変えられる", () => {
    const deck = run(many(7), settings({ continuationSuffix: " のつづき" }));
    expect(deck.slides[1].title).toBe("A のつづき");
  });

  it("test_上限は設定で変えられる（3〜10）", () => {
    expect(run(many(7), settings({ maxBulletItems: 10 })).slides).toHaveLength(
      1,
    );
    expect(run(many(7), settings({ maxBulletItems: 3 })).slides).toHaveLength(
      3,
    );
  });
});

describe("CFG-46 溢れは許さない（詳しくでも割る）", () => {
  const long = `## A\n\n${Array.from({ length: 12 }, (_, i) => `${"あ".repeat(200)}${i}`).join("\n\n")}\n`;

  it("test_収まらない枚は割る", () => {
    const deck = run(long, settings({ density: "full" }));
    expect(deck.slides.length).toBeGreaterThan(1);
  });

  it("test_割ったあとは溢れが消える", () => {
    const config = settings({ density: "full" });
    const deck = run(long, config);
    expect(overflowingSlides(deck, slideMetrics(config))).toEqual([]);
  });

  it("test_1 つで溢れる塊はそのまま置く（無限に割らない）", () => {
    const huge = `## A\n\n${"あ".repeat(6000)}\n`;
    const deck = run(huge);
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].blocks).toHaveLength(1);
  });
});

describe("CFG-41 要点のみ", () => {
  const doc = "## A\n\n本文の段落。\n\n- 箇条書き\n";

  it("test_標準では本文を残す", () => {
    const deck = run(doc, settings({ density: "normal" }));
    expect(deck.slides[0].blocks).toHaveLength(2);
  });

  it("test_要点のみでは段落を発表者ノートへ回す", () => {
    const deck = run(doc, settings({ density: "sparse" }));
    expect(deck.slides[0].blocks.map((b) => b.kind)).toEqual(["bullet"]);
    expect(deck.slides[0].notes).toContain("本文の段落。");
  });

  it("test_元からある発表者ノートは消さない", () => {
    const withNote = "## A\n\n> 話すこと\n\n本文。\n";
    const deck = run(withNote, settings({ density: "sparse" }));
    expect(deck.slides[0].notes).toContain("話すこと");
    expect(deck.slides[0].notes).toContain("本文。");
  });
});

describe("触らないもの", () => {
  it("test_扉と表紙はそのまま", () => {
    const deck = run("# 題\n\n副題\n\n# 扉\n\n## A\n\nあ\n");
    expect(deck.title).toBe("題");
    expect(deck.subtitle).toBe("副題");
    expect(deck.slides[0].kind).toBe("section");
  });

  it("test_画像と発表者ノートは最初の枚に残す", () => {
    const doc = `## A\n\n![](a.png)\n\n> 話すこと\n\n${Array.from(
      { length: 9 },
      (_, i) => `- 項目${i}`,
    ).join("\n")}\n`;
    const deck = run(doc);
    expect(deck.slides[0].images).toHaveLength(1);
    expect(deck.slides[0].notes).toBe("話すこと");
    expect(deck.slides[1].images).toEqual([]);
    expect(deck.slides[1].notes).toBe("");
  });
});
