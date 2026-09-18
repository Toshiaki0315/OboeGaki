// Word 書き出しの golden（19-4 の残り）。buildDocx を分割する前に、出来上がる
// document.xml と numbering.xml の字面を固定する。ブロックの種類を全部含む 1 本の
// Markdown から組み、fixtures/golden/ の写しと突き合わせる。**意図して変えるときは**
// `npx vitest run -u` で写しを更新し、差分をレビューする

import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { buildDocx } from "./export-docx";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const SAMPLE = `---
title: 報告書
---
# 題

## 小見出し

### 三

**太字**と*斜体*と~~打ち消し~~と==印==と\`code\`と[リンク](https://x.com)と<span style="color: #e53935">赤</span>[^1]。
二行目  
強制改行のあと。

- a
  - b
- [ ] todo
- [x] done

3. x
4. y

\`\`\`js:index.js
const x = 1;

\`\`\`

\`\`\`mermaid
graph TD; A-->B
\`\`\`

> 引用
>
> > 二重

---

| 見出し | 数 |
| --- | --- |
| りんご | 3 |

![絵|100](a.png)

![無い](missing.png)

和は $a+b$ です

$$
E = mc^2
$$

:::details 呼び名
中身
:::

![[別のノート]]

[^1]: 注の中身
`;

async function parts(): Promise<{ document: string; numbering: string }> {
  const base64 = await buildDocx(SAMPLE, {
    title: "t",
    resolveImage: async (url) => (url === "a.png" ? PNG : null),
    embeds: new Map([["別のノート", "埋め込んだ本文\n"]]),
    bodyFont: "Hiragino Sans",
    monoFont: "Menlo",
  });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const read = async (name: string) =>
    (await zip.file(name)?.async("string")) ?? "";
  // ハイパーリンクの関係 id（r:id="rId…"）は docx が毎回乱数で振る。中身では
  // ないので揃えてから比べる
  const stable = (xml: string) =>
    xml.replace(/r:id="rId[^"]*"/g, 'r:id="rId#"');
  return {
    document: stable(await read("word/document.xml")),
    numbering: stable(await read("word/numbering.xml")),
  };
}

describe("buildDocx の golden", () => {
  test("test_同じ入力からは同じ字面が出る（決定的）", async () => {
    const [a, b] = await Promise.all([parts(), parts()]);
    expect(a).toEqual(b);
  });

  test("test_document_xml_は写しと一致する", async () => {
    const { document } = await parts();
    await expect(document).toMatchFileSnapshot(
      "../../fixtures/golden/export-docx.document.xml",
    );
  });

  test("test_numbering_xml_は写しと一致する", async () => {
    const { numbering } = await parts();
    await expect(numbering).toMatchFileSnapshot(
      "../../fixtures/golden/export-docx.numbering.xml",
    );
  });
});
