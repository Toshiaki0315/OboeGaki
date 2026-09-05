// 折りたたみ（TASKS 6-2、要望 2026-09-05）。

import { describe, expect, test } from "vitest";
import { Text } from "@codemirror/state";
import {
  DEFAULT_SUMMARY,
  detailsContainers,
  detailsSection,
} from "./details-container";

const of = (text: string) => Text.of(text.split("\n"));

describe("detailsContainers", () => {
  test("test_覚書の記法を見つける", () => {
    const doc = of(":::details 詳しく\n中身\n:::\n");
    expect(detailsContainers(doc)).toEqual([
      {
        from: 0,
        to: doc.line(3).to,
        summary: "詳しく",
        form: "container",
        open: { from: 0, to: doc.line(1).to },
        close: { from: doc.line(3).from, to: doc.line(3).to },
      },
    ]);
  });

  test("test_Qiita から貼った HTML も受ける（読むときだけ）", () => {
    const doc = of("<details><summary>詳しく</summary>\n中身\n</details>\n");
    const found = detailsContainers(doc);
    expect(found.map((entry) => [entry.form, entry.summary])).toEqual([
      ["html", "詳しく"],
    ]);
    expect(found[0].close).toEqual({
      from: doc.line(3).from,
      to: doc.line(3).to,
    });
  });

  test("test_呼び名を書いていなければ既定の呼び名", () => {
    expect(detailsContainers(of(":::details\n中身\n:::\n"))[0].summary).toBe(
      DEFAULT_SUMMARY,
    );
    expect(
      detailsContainers(of("<details>\n中身\n</details>\n"))[0].summary,
    ).toBe(DEFAULT_SUMMARY);
  });

  test("test_閉じが無ければ囲みにしない", () => {
    // 書きかけの `:::details` で以降が全部畳めると読めない
    expect(detailsContainers(of(":::details 詳しく\n中身\n"))).toEqual([]);
  });

  test("test_`:::note` は拾わない", () => {
    expect(detailsContainers(of(":::note info\n中身\n:::\n"))).toEqual([]);
  });

  test("test_続けて 2 つあっても別々に見つける", () => {
    const doc = of(":::details 一\n中\n:::\n\n:::details 二\n中\n:::\n");
    expect(detailsContainers(doc).map((entry) => entry.summary)).toEqual([
      "一",
      "二",
    ]);
  });
});

describe("detailsSection", () => {
  test("test_畳むのは中身だけ（閉じの行は残す）", () => {
    const doc = of(":::details 詳しく\n中身\nもう一行\n:::\n");
    expect(detailsSection(doc, 0)).toEqual({
      from: doc.line(1).to,
      to: doc.line(3).to,
    });
  });

  test("test_HTML の形でも畳める", () => {
    const doc = of("<details><summary>詳しく</summary>\n中身\n</details>\n");
    expect(detailsSection(doc, 0)).toEqual({
      from: doc.line(1).to,
      to: doc.line(2).to,
    });
  });

  test("test_中身が無ければ畳まない", () => {
    const doc = of(":::details 詳しく\n:::\n");
    expect(detailsSection(doc, 0)).toBeNull();
  });

  test("test_開きの行でなければ畳まない", () => {
    const doc = of(":::details 詳しく\n中身\n:::\n");
    expect(detailsSection(doc, doc.line(2).from)).toBeNull();
  });
});
