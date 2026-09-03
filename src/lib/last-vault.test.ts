import { describe, expect, it } from "vitest";
import {
  isVaultBusy,
  restoreLastVault,
  saveLastVault,
  VAULT_BUSY,
  VAULT_KEY,
} from "./last-vault";

// localStorage の代役。実物は WebView にしか無いので注入で切り離す
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe("saveLastVault", () => {
  it("test_保存すると次回の復元候補になる", () => {
    const storage = fakeStorage();
    saveLastVault(storage, "/v/notes");
    expect(storage.dump()[VAULT_KEY]).toBe("/v/notes");
  });

  it("test_保存先が壊れていても例外を漏らさない", () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(() => saveLastVault(broken, "/v/notes")).not.toThrow();
  });
});

describe("restoreLastVault", () => {
  it("test_記憶があれば開いてそのパスを返す", async () => {
    const storage = fakeStorage({ [VAULT_KEY]: "/v/notes" });
    const opened: string[] = [];
    const result = await restoreLastVault(storage, async (root) => {
      opened.push(root);
    });
    expect(result).toBe("/v/notes");
    expect(opened).toEqual(["/v/notes"]);
  });

  it("test_記憶がなければ何もせず_nullを返す", async () => {
    const storage = fakeStorage();
    const result = await restoreLastVault(storage, async () => {
      throw new Error("呼ばれてはいけない");
    });
    expect(result).toBeNull();
  });

  it("test_開けなかったら記憶を消して_nullを返す", async () => {
    // フォルダが消えた・権限が無いなど。次回また失敗し続けないよう忘れる
    const storage = fakeStorage({ [VAULT_KEY]: "/v/gone" });
    const result = await restoreLastVault(storage, async () => {
      throw new Error("開けない");
    });
    expect(result).toBeNull();
    expect(storage.dump()[VAULT_KEY]).toBeUndefined();
  });

  it("test_別の窓が開いているときは記憶を忘れずに投げ返す", async () => {
    // 「開けない」と違い、**次回は開けるかもしれない**（向こうを閉じれば
    // よい）。忘れると、閉じたあとに前回の vault へ戻れなくなる
    const storage = fakeStorage({ [VAULT_KEY]: "/v/notes" });
    await expect(
      restoreLastVault(storage, async () => {
        throw new Error(`${VAULT_BUSY}: 既に別のウィンドウで開いています`);
      }),
    ).rejects.toThrow();
    expect(storage.dump()[VAULT_KEY]).toBe("/v/notes");
  });

  it("test_読み出しが例外を投げても_nullで済ませる", async () => {
    const broken = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const result = await restoreLastVault(broken, async () => {});
    expect(result).toBeNull();
  });
});

describe("isVaultBusy", () => {
  it("test_二重起動の断りだけを見分ける", () => {
    expect(isVaultBusy(new Error(`${VAULT_BUSY}: 開いています`))).toBe(true);
    expect(isVaultBusy("開けない")).toBe(false);
  });
});
