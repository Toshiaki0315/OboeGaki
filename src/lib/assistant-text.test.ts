// アシスタントの画面に出す言葉（ADR-0025 追記）。
//
// 「モデルを読み込んでいます…」の場つなぎが、先に届いた断りを
// 上書きして**永久に残る**事故が実機で起きた（モデル名の打ち間違いで
// 404 が生成の起動確認より速く返る）。言葉の選び方と場つなぎの
// 出し引きを純関数に切り出して、ここで固める。

import { describe, expect, it } from "vitest";
import {
  LOADING_NOTICE,
  appendChunk,
  llmErrorText,
  loadingNotice,
} from "./assistant-text";

describe("llmErrorText", () => {
  it("動いていないときは入れ方を案内する", () => {
    expect(llmErrorText("not-running", 10, "gemma3:4b")).toContain("Ollama");
  });

  it("時間切れは動いていない扱いにしない", () => {
    const text = llmErrorText("timed-out", 10, "gemma3:4b");
    expect(text).toContain("10 分");
    expect(text).not.toContain("動いていません");
  });

  it("404はモデルが入っていないと言う", () => {
    // Ollama は無いモデルへの生成に 404 を返す。「HTTP 404」のままでは
    // 設定のモデル名を疑えない
    const text = llmErrorText(
      'failed: HTTP 404: model "gemma3:4b" not found, try pulling it first',
      10,
      "gemma3:4b",
    );
    expect(text).toContain("gemma3:4b");
    expect(text).toContain("入っていません");
  });

  it("その他の失敗は中身ごと見せる", () => {
    expect(llmErrorText("failed: HTTP 500", 10, "m")).toContain("HTTP 500");
  });
});

describe("loadingNotice", () => {
  it("答えがまだ無ければ場つなぎを出す", () => {
    expect(loadingNotice("")).toBe(LOADING_NOTICE);
  });

  it("先に届いた断りや答えを上書きしない", () => {
    // 404 の断りは生成の起動確認より速く返ることがある（実機で発生）
    expect(loadingNotice("モデルが入っていません")).toBe(
      "モデルが入っていません",
    );
  });
});

describe("appendChunk", () => {
  it("答えを継ぎ足す", () => {
    expect(appendChunk("これは", "答え")).toBe("これは答え");
  });

  it("最初のひとかけらが届いたら場つなぎを消す", () => {
    // 消さないと「モデルを読み込んでいます…要約は——」と繋がって見える
    expect(appendChunk(LOADING_NOTICE, "要約です")).toBe("要約です");
  });
});
