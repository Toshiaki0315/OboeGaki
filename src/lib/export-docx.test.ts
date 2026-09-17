// Word（.docx）書き出し（ADR-0059 / 12-8）。出来上がった document.xml で確かめる
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { buildDocx } from "./export-docx";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function documentXml(
  markdown: string,
  resolveImage: (url: string) => Promise<string | null> = async () => null,
): Promise<string> {
  const base64 = await buildDocx(markdown, { title: "t", resolveImage });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  return (await zip.file("word/document.xml")?.async("string")) ?? "";
}

describe("buildDocx", () => {
  test("test_見出しは Word の見出しスタイルに割り当て_装飾は run に写す", async () => {
    const xml = await documentXml(
      "# 題\n\n## 小見出し\n\n**太字**と*斜体*と~~打ち消し~~と`code`と[リンク](https://x.com)\n",
    );
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:strike/>");
    expect(xml).toMatch(/w:ascii="[^"]*(Menlo|Consolas|Courier)/);
    expect(xml).toContain("<w:hyperlink");
    expect(xml).not.toContain("**");
  });

  test("test_箇条書きと番号付きは番号付けを持ち_表は表になる", async () => {
    const xml = await documentXml(
      "- a\n  - b\n\n1. x\n2. y\n\n| 見出し | 数 |\n| --- | --- |\n| りんご | 3 |\n",
    );
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("りんご");
    expect(xml).toContain('<w:ilvl w:val="1"/>'); // 入れ子
  });

  test("test_コードは等幅と地の色_引用は字下げ_水平線は罫線", async () => {
    const xml = await documentXml(
      "```js\nconst x = 1;\n```\n\n> 引用\n\n---\n",
    );
    expect(xml).toContain("const x = 1;");
    expect(xml).toContain("<w:shd");
    expect(xml).toContain("引用");
    expect(xml).toContain("<w:ind");
    expect(xml).toContain("<w:pBdr>");
  });

  test("test_画像は埋め込み_読めない画像は飛ばす_文字色は run の色", async () => {
    const xml = await documentXml(
      '![絵](a.png)\n\n![無い](missing.png)\n\n<span style="color: #e53935">赤</span>\n',
      async (url) => (url === "a.png" ? PNG : null),
    );
    expect(xml).toContain("<w:drawing>");
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(1);
    expect(xml).toContain('<w:color w:val="E53935"/>');
  });

  test("test_front matter の title は表題に_front matter 自体は出さない", async () => {
    const xml = await documentXml("---\ntitle: 報告書\nid: x\n---\n本文\n");
    expect(xml).toContain('w:val="Title"');
    expect(xml).toContain("報告書");
    expect(xml).not.toContain("id: x");
  });

  test("test_数式は元の LaTeX を等幅で置く", async () => {
    const xml = await documentXml("和は $a+b$ です\n");
    expect(xml).toContain("a+b");
    expect(xml).not.toContain("<math");
  });
});

describe("棚卸しレビュー 2026-09-17（Word 書き出し）", () => {
  test("test_やることの印は残す", async () => {
    // markdown-it-task-lists の <input> は html_inline で来て、捨てられていた
    const xml = await documentXml("- [ ] todo\n- [x] done\n");
    expect(xml).toContain("☐");
    expect(xml).toContain("☑");
    expect(xml).toContain("todo");
  });

  test("test_画像の大きさ指定（|100）を写す", async () => {
    // 6-8 の `![a|100](a.png)` は HTML では width になるのに Word は自然サイズだけだった
    const xml = await documentXml("![a|100](a.png)\n", async () => PNG);
    expect(xml).toMatch(/<wp:extent cx="952500"/); // 100px = 952500 EMU
  });

  test("test_コードのファイル名を出す（ADR-0008: 画面にも書き出しにも）", async () => {
    const xml = await documentXml("```js:index.js\nconst x = 1;\n```\n");
    expect(xml).toContain("index.js");
    expect(xml).toContain("const x = 1;");
  });

  test("test_脚注の本文にも番号が付く", async () => {
    const xml = await documentXml("本文[^1]\n\n[^1]: 注の中身\n");
    // 本文側の [1] と、注の側の [1] 注の中身
    expect((xml.match(/\[1\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(xml).toMatch(/\[1\][^<]*<\/w:t>(?:(?!<\/w:p>).)*注の中身/s);
  });

  test("test_番号付きの開始値を写す", async () => {
    const xml = await documentXml("3. x\n4. y\n");
    expect(xml).toContain("x");
    // 開始値は numbering.xml 側に出るので document ではなく zip 全体で見る
    const base64 = await buildDocx("3. x\n4. y\n", {
      title: "t",
      resolveImage: async () => null,
    });
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const numbering =
      (await zip.file("word/numbering.xml")?.async("string")) ?? "";
    expect(numbering).toContain('<w:start w:val="3"/>');
  });
});
