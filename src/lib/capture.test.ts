// 書き取りの窓の見分け（ADR-0057）。主窓と同じ index.html を URL の印で見分ける。

import { describe, expect, test } from "vitest";
import { captureUrl, isCaptureWindow } from "./capture";

describe("isCaptureWindow", () => {
  test("test_capture=1_のときだけ書き取りの窓", () => {
    expect(isCaptureWindow("?capture=1")).toBe(true);
    expect(isCaptureWindow("?capture=0")).toBe(false);
    expect(isCaptureWindow("")).toBe(false);
    expect(isCaptureWindow("?x=1")).toBe(false);
  });

  test("test_captureUrl_は自分で見分けられる形（往復）", () => {
    expect(captureUrl()).toBe("index.html?capture=1");
    expect(isCaptureWindow(new URL(captureUrl(), "http://x/").search)).toBe(
      true,
    );
  });
});
