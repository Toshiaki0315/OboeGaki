import { describe, expect, it } from "vitest";
import {
  canDropInto,
  canMoveFolderInto,
  FOLDER_DRAG_TYPE,
  isFolderDrag,
  folderOf,
  isFileDrag,
  isNoteDrag,
  NOTE_DRAG_TYPE,
} from "./note-drop";

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

describe("isFileDrag", () => {
  it("test_Finder からのファイルは types に Files が載る", () => {
    expect(isFileDrag(["Files"])).toBe(true);
    expect(isFileDrag(["Files", "public.file-url"])).toBe(true);
  });
  it("test_文字やノートの落下はファイルではない", () => {
    expect(isFileDrag(["text/plain"])).toBe(false);
    expect(isFileDrag([NOTE_DRAG_TYPE])).toBe(false);
    expect(isFileDrag([])).toBe(false);
  });
});

// フォルダも掴んで別のフォルダへ落とせる（要望 2026-09-10）
describe("canMoveFolderInto", () => {
  it("test_別のフォルダの中や直下へは動かせる", () => {
    expect(canMoveFolderInto("仕事/会議", "保管")).toBe(true);
    expect(canMoveFolderInto("仕事/会議", "")).toBe(true);
  });
  it("test_自分の中_子の中_同じ親へは動かせない", () => {
    expect(canMoveFolderInto("仕事", "仕事")).toBe(false);
    expect(canMoveFolderInto("仕事", "仕事/会議")).toBe(false);
    expect(canMoveFolderInto("仕事/会議", "仕事")).toBe(false); // 今の親
    expect(canMoveFolderInto("仕事", "")).toBe(false); // 直下のものを直下へ
    // 「仕事」を「仕事場」の中へは動かせる（前方一致ではなく区切りで見る）
    expect(canMoveFolderInto("仕事", "仕事場")).toBe(true);
  });
});

describe("isFolderDrag", () => {
  it("test_フォルダの目印で見分ける", () => {
    expect(isFolderDrag([FOLDER_DRAG_TYPE])).toBe(true);
    expect(isFolderDrag(["application/x-oboegaki-note"])).toBe(false);
  });
});
