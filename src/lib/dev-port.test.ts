import { describe, expect, it } from "vitest";
import { DEV_PORT_ENV, DEFAULT_DEV_PORT, resolveDevPort } from "./dev-port";

describe("resolveDevPort", () => {
  it("test_未設定なら既定の1430を使う", () => {
    expect(resolveDevPort({})).toEqual({ port: 1430, hmrPort: 1431 });
    expect(DEFAULT_DEV_PORT).toBe(1430);
  });

  it("test_環境変数で上書きできる", () => {
    expect(resolveDevPort({ [DEV_PORT_ENV]: "1500" })).toEqual({
      port: 1500,
      hmrPort: 1501,
    });
  });

  it("test_空文字や空白だけの指定は未設定と同じに扱う", () => {
    expect(resolveDevPort({ [DEV_PORT_ENV]: "" }).port).toBe(DEFAULT_DEV_PORT);
    expect(resolveDevPort({ [DEV_PORT_ENV]: "  " }).port).toBe(
      DEFAULT_DEV_PORT,
    );
  });

  it("test_前後の空白は無視する", () => {
    expect(resolveDevPort({ [DEV_PORT_ENV]: " 1500 " }).port).toBe(1500);
  });

  it("test_数値でない指定は取り違えを避けるため即座に失敗させる", () => {
    expect(() => resolveDevPort({ [DEV_PORT_ENV]: "abc" })).toThrow(
      /OBOEGAKI_DEV_PORT/,
    );
    expect(() => resolveDevPort({ [DEV_PORT_ENV]: "1500.5" })).toThrow(
      /OBOEGAKI_DEV_PORT/,
    );
  });

  it("test_特権ポートや範囲外は失敗させる", () => {
    expect(() => resolveDevPort({ [DEV_PORT_ENV]: "80" })).toThrow(/1024/);
    // HMR が隣を取るため、指定できる上限は 65534
    expect(() => resolveDevPort({ [DEV_PORT_ENV]: "70000" })).toThrow(/65534/);
  });

  it("test_HMRは本体の次のポートを使う（衝突を1組で済ませる）", () => {
    expect(resolveDevPort({ [DEV_PORT_ENV]: "1600" }).hmrPort).toBe(1601);
  });

  it("test_末尾ポート65535はHMRの隣が取れないため失敗させる", () => {
    expect(() => resolveDevPort({ [DEV_PORT_ENV]: "65535" })).toThrow(/65535/);
  });
});
