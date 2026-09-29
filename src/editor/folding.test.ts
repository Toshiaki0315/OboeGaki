// 見出し単位の折りたたみ（TASKS 2-4、ADR-0019）。
// 畳む範囲は純関数。見出しの行末から、同じか浅い見出しの手前まで。

import { describe, expect, test } from "vitest";
import { ensureSyntaxTree, foldable, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { headingFolding, headingSection } from "./folding";
import { LANG, stateOf } from "./test-utils";

function sectionText(doc: string, lineNumber: number): string | null {
  const state = stateOf(doc);
  const line = state.doc.line(lineNumber);
  const range = headingSection(state, line.from);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

const DOC = `# 大見出し
一行目

## 小見出しA
中身A

## 小見出しB
中身B

# 次の大見出し
末尾`;

describe("headingSection", () => {
  test("test_h2は次のh2の手前まで畳む", () => {
    expect(sectionText(DOC, 4)).toBe("\n中身A\n");
  });

  test("test_長いノートの終わりの見出しも畳める", () => {
    // **`syntaxTree` は時間で打ち切られる。** 木が未完成のまま返ると
    // 見出しが見つからず、畳む印がガターから消える（2026-09-05。
    // plain-copy・outline・focusRange と同じ根）
    const filler = Array.from({ length: 3000 }, (_, i) => `行 ${i}`).join("\n");
    const long = `# 頭\n${filler}\n\n## 最後\n中身\n`;
    const lines = long.split("\n").length;
    expect(sectionText(long, lines - 2)).toBe("\n中身\n");
  });

  test("test_h1は配下のh2ごと巻き込む", () => {
    expect(sectionText(DOC, 1)).toBe(
      "\n一行目\n\n## 小見出しA\n中身A\n\n## 小見出しB\n中身B\n",
    );
  });

  test("test_最後の節は文書末まで畳む", () => {
    expect(sectionText(DOC, 10)).toBe("\n末尾");
  });

  test("test_見出しでない行は畳めない", () => {
    expect(sectionText(DOC, 2)).toBeNull();
    expect(sectionText(DOC, 5)).toBeNull();
  });

  test("test_中身が無い見出しは畳めない", () => {
    expect(sectionText("# 見出しだけ", 1)).toBeNull();
  });

  test("test_コードフェンスの中のシャープは見出しではない", () => {
    // 畳む範囲は前の行の行末まで（次見出しの直前の改行は畳みに含めない）
    const doc = "## 節\n```\n# コメント\n```\nあと\n## 次";
    expect(sectionText(doc, 1)).toBe("\n```\n# コメント\n```\nあと");
  });
});

describe("折りたたみの囲み（6-2 / 22-1）", () => {
  const foldAt = (doc: string, lineNumber: number) => {
    const state = stateOf(doc, 0, [LANG, headingFolding]);
    const line = state.doc.line(lineNumber);
    return foldable(state, line.from, line.to);
  };

  test("test_コード例の_:::details_は畳めない", () => {
    expect(foldAt("```\n:::details 例\n中\n:::\n```\n", 2)).toBeNull();
  });

  test("test_中のフェンスの_:::_では止まらず_本当の閉じの手前まで畳む", () => {
    const doc = ":::details 詳しく\n```\n:::\n```\n中身\n:::\n";
    const range = foldAt(doc, 1);
    expect(range).not.toBeNull();
    expect(doc.slice(range!.from, range!.to)).toBe("\n```\n:::\n```\n中身");
  });

  test("test_入れ子で字のまま見える_:::details_は畳めない（レビュー 2026-09-29）", () => {
    // 画面は囲みにしない（ADR-0069 の決定 3）ので、▾ も出さない
    expect(foldAt(":::note\n:::details 内\n中\n:::\n:::\n\n後", 2)).toBeNull();
    expect(
      foldAt('<div align="center">\n:::details 内\n中\n:::\n</div>\n\n後', 2),
    ).toBeNull();
    // 外に書いた :::details は今までどおり畳める
    expect(foldAt(":::details 外\n中\n:::\n", 1)).not.toBeNull();
  });

  test("test_解析が追いついたら数え直す（控えは構文木ごと。レビュー 2026-09-29）", () => {
    // 長いノートを開いた直後は、先のフェンスまで解析が届いていない。フェンスの中の
    // `:::note` を本物の開きと数えると、後ろの本物の :::details を入れ子とみなして
    // 畳めない。解析が追いついても文書は同じなので、文書で控えると直らなかった
    const filler = Array.from({ length: 60_000 }, (_, i) => `段落 ${i}`).join(
      "\n\n",
    );
    const doc = `${filler}\n\n\`\`\`\n:::note\n\`\`\`\n\n:::details 詳しく\n中\n:::\n`;
    const partial = stateOf(doc, 0, [LANG, headingFolding]);
    expect(syntaxTree(partial).length).toBeLessThan(doc.length);
    const line = (state: EditorState) => state.doc.line(state.doc.lines - 3); // `:::details 詳しく`
    const at = line(partial);
    expect(at.text).toBe(":::details 詳しく");
    foldable(partial, at.from, at.to); // 途中までの木で一度数えさせる
    ensureSyntaxTree(partial, doc.length, 10_000);
    const caught = partial.update({}).state;
    expect(syntaxTree(caught).length).toBe(doc.length);
    // details として畳む（閉じの行は残す）。段落としての畳み（閉じの行まで）が
    // 返るのは、details と認めていない印
    expect(foldable(caught, at.from, at.to)).toEqual({
      from: at.to,
      to: caught.doc.line(at.number + 1).to,
    });
  });
});
