// @vitest-environment jsdom
// 画像ファイルの落下を本文へ挿す（TASKS 1-2 / ADR-0043）。CM6 のイベントは
// `.cm-content` にしか付かないので、本文の外に落とされたぶんは App から
// この入口へ渡す（実機報告 2026-09-08: 余白に落とすと WebView が画像
// ファイルそのものを開いてしまった）。

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test, vi } from "vitest";
import { dropFiles } from "./attachments";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function editor(doc: string, cursor: number): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: cursor } }),
    parent: document.body,
  });
  return view;
}

const png = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "図.png", {
    type: "image/png",
  });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("dropFiles", () => {
  test("test_画像を落とすと保存してカーソル位置に貼り込む", async () => {
    const save = vi.fn(
      async (_data: Uint8Array, name: string) => `![](attachments/${name})`,
    );
    const cm = editor("前\n後", 1);
    expect(dropFiles(cm, [png()], null, save)).toBe(true);
    await flush();
    expect(save).toHaveBeenCalledWith(expect.any(Uint8Array), "図.png");
    expect(cm.state.doc.toString()).toBe("前![](attachments/図.png)\n後");
  });

  test("test_画像でないファイルは受け取らない（既定の処理に任せる）", async () => {
    const save = vi.fn(async () => null);
    const cm = editor("本文", 0);
    expect(
      dropFiles(
        cm,
        [new File(["a,b"], "表.csv", { type: "text/csv" })],
        null,
        save,
      ),
    ).toBe(false);
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(cm.state.doc.toString()).toBe("本文");
  });

  test("test_保存できなかったぶんは本文に何も入れない", async () => {
    const cm = editor("本文", 2);
    expect(dropFiles(cm, [png()], null, async () => null)).toBe(true);
    await flush();
    expect(cm.state.doc.toString()).toBe("本文");
  });
});
