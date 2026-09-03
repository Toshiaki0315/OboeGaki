// クイックオープン（Cmd+O）のファジー一致。順位の直感をここで固定する。

import { describe, expect, test } from "vitest";
import { fuzzyScore, rankCandidates } from "./fuzzy";

describe("fuzzyScore", () => {
  test("部分列として現れれば一致、途切れていれば不一致", () => {
    expect(fuzzyScore("かいぎ", "かい議事ぎろく")).not.toBeNull();
    expect(fuzzyScore("会議", "会のあとで議論")).not.toBeNull();
    expect(fuzzyScore("会議", "議会")).toBeNull(); // 順序が逆
  });

  test("ASCII は大文字小文字を区別しない", () => {
    expect(fuzzyScore("readme", "README")).not.toBeNull();
  });

  test("空クエリはすべてに一致する（一覧をそのまま出す）", () => {
    expect(fuzzyScore("", "何でも")).not.toBeNull();
  });

  test("連続一致と先頭一致は飛び飛びより高く採点する", () => {
    const consecutive = fuzzyScore("会議", "会議メモ")!;
    const scattered = fuzzyScore("会議", "会のあとで議論")!;
    expect(consecutive).toBeGreaterThan(scattered);
    const atStart = fuzzyScore("メモ", "メモ帳")!;
    const inMiddle = fuzzyScore("メモ", "会議メモ")!;
    expect(atStart).toBeGreaterThan(inMiddle);
  });

  test("フォルダ区切りの直後も先頭とみなす", () => {
    const afterSlash = fuzzyScore("日次", "日記/日次レビュー")!;
    const inMiddle = fuzzyScore("日次", "きのうの日次")!;
    expect(afterSlash).toBeGreaterThan(inMiddle);
  });
});

describe("rankCandidates", () => {
  test("一致するものだけを点の高い順に返す", () => {
    const labels = ["会議メモ", "議会だより", "会のあとで議論", "無関係"];
    expect(rankCandidates("会議", labels)).toEqual([0, 2]);
  });

  test("空クエリは元の順のまま全部返す", () => {
    expect(rankCandidates("", ["b", "a"])).toEqual([0, 1]);
  });
});
