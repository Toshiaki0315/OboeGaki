// 画面に出るアプリ名（ADR-0047）。散らばった文字列を 1 つに束ねた。

import { describe, expect, it } from "vitest";
import { APP_NAME } from "./app-name";

describe("表示名", () => {
  it("test_ひらがなの「おぼえがき」", () => {
    expect(APP_NAME).toBe("おぼえがき");
  });
});
