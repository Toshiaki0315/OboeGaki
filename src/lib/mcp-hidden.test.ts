// 「Claude に渡さない」の判定（GUI の印）。`.mcp-ignore` の中身と突き合わせる。

import { describe, expect, it } from "vitest";
import { hiddenByAncestor, isHiddenFromMcp, relativeIn } from "./mcp-hidden";

describe("relativeIn", () => {
  it("test_保管フォルダの下を相対にする", () => {
    expect(relativeIn("/vault", "/vault/仕事/会議.md")).toBe("仕事/会議.md");
    expect(relativeIn("/vault", "仕事")).toBe("仕事");
    expect(relativeIn("/vault", "/vault")).toBe("");
  });
});

describe("isHiddenFromMcp", () => {
  const hidden = {
    listed: ["プライベート", "仕事/評価", "秘密のメモ.md"],
    builtin: [".trash", ".OboeGaki", "attachments", "templates"],
  };

  it("test_名指しされていれば隠れている", () => {
    expect(isHiddenFromMcp(hidden, "プライベート")).toBe(true);
    expect(isHiddenFromMcp(hidden, "秘密のメモ.md")).toBe(true);
  });

  it("test_隠したフォルダの中も隠れている", () => {
    expect(isHiddenFromMcp(hidden, "プライベート/日記.md")).toBe(true);
    expect(isHiddenFromMcp(hidden, "仕事/評価/2026.md")).toBe(true);
  });

  it("test_前方一致では隠さない（プライベート2 は別物）", () => {
    expect(isHiddenFromMcp(hidden, "プライベート2/x.md")).toBe(false);
    expect(isHiddenFromMcp(hidden, "仕事/会議.md")).toBe(false);
  });

  it("test_空は隠さない（保管フォルダそのもの）", () => {
    expect(isHiddenFromMcp(hidden, "")).toBe(false);
  });

  it("test_最初から見せない場所も隠れている（Rust と同じ判断）", () => {
    // 一覧に出ないので画面には現れないが、**判断は 1 つ**にしておく
    expect(isHiddenFromMcp(hidden, "templates/議事録.md")).toBe(true);
    expect(isHiddenFromMcp(hidden, ".trash/捨てた.md")).toBe(true);
  });

  it("test_ドットで始まる成分がどこかにあれば隠れている（Rust の規則と揃える）", () => {
    // `scan()` はどの階層でもドットフォルダを飛ばす。MCP も途中の
    // `.secret/` を隠すことにした（15-12）ので、印もそれに揃える
    expect(isHiddenFromMcp(hidden, ".git/config")).toBe(true);
    expect(isHiddenFromMcp(hidden, "仕事/.secret/x.md")).toBe(true);
    expect(isHiddenFromMcp(hidden, "ふつう/.隠し.md")).toBe(true);
    expect(isHiddenFromMcp(hidden, "ふつう/隠し.md")).toBe(false);
  });
});

describe("hiddenByAncestor", () => {
  const hidden = {
    listed: ["プライベート", "仕事/評価", "秘密のメモ.md"],
    builtin: [".trash", ".OboeGaki", "attachments", "templates"],
  };

  it("test_親フォルダの名指しで隠れているなら_その親を返す", () => {
    // その 1 行を消しても親の行が残るので、「渡す」は効かない。押す前に
    // 理由を見せるための判断（レビュー 2026-09-14）
    expect(hiddenByAncestor(hidden, "プライベート/日記.md")).toBe(
      "プライベート",
    );
    expect(hiddenByAncestor(hidden, "仕事/評価/2026.md")).toBe("仕事/評価");
    expect(hiddenByAncestor(hidden, "templates/議事録.md")).toBe("templates");
  });

  it("test_自分が名指しされているなら_null（自分で外せる）", () => {
    expect(hiddenByAncestor(hidden, "プライベート")).toBeNull();
    expect(hiddenByAncestor(hidden, "秘密のメモ.md")).toBeNull();
  });

  it("test_隠れていなければ_null", () => {
    expect(hiddenByAncestor(hidden, "仕事/会議.md")).toBeNull();
    expect(hiddenByAncestor(hidden, "")).toBeNull();
  });
});
