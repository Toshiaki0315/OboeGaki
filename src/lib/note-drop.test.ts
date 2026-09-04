import { describe, expect, it } from "vitest";
import { canDropInto, folderOf, isNoteDrag, NOTE_DRAG_TYPE } from "./note-drop";

const root = "/v/notes";

describe("folderOf", () => {
  it("test_直下のノートは空", () => {
    expect(folderOf(root, `${root}/買い物.md`)).toBe("");
  });

  it("test_フォルダの中なら相対のフォルダ名", () => {
    expect(folderOf(root, `${root}/仕事/議事録.md`)).toBe("仕事");
    expect(folderOf(root, `${root}/仕事/2026/09.md`)).toBe("仕事/2026");
  });
});

describe("canDropInto", () => {
  it("test_別のフォルダへは落とせる", () => {
    expect(canDropInto(root, `${root}/a.md`, "仕事")).toBe(true);
    expect(canDropInto(root, `${root}/仕事/a.md`, "")).toBe(true);
  });

  it("test_今いるフォルダへは落とせない", () => {
    // 受け付けても何も起きないのに「移しました」と出てしまう
    expect(canDropInto(root, `${root}/a.md`, "")).toBe(false);
    expect(canDropInto(root, `${root}/仕事/a.md`, "仕事")).toBe(false);
  });
});

describe("isNoteDrag", () => {
  it("test_こちらが載せた型があればノートの落下と見なす", () => {
    expect(isNoteDrag([NOTE_DRAG_TYPE, "text/plain"])).toBe(true);
  });

  it("test_よそからの文字やファイルは受けない", () => {
    // Finder からの画像は本文側（editor/attachments）が受ける。
    // フォルダの行が横取りすると、貼り込みができなくなる
    expect(isNoteDrag(["Files"])).toBe(false);
    expect(isNoteDrag(["text/plain"])).toBe(false);
    expect(isNoteDrag([])).toBe(false);
  });
});
