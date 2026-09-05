// 環境設定（TASKS 3-9）。置き場は 1-1 / 1-5 と同じ localStorage。

import { describe, expect, it, test } from "vitest";
import {
  clampPaneWidth,
  contentWidthCss,
  DEFAULT_SETTINGS,
  HISTORY_CHOICES,
  loadSettings,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  resolveTheme,
  saveSettings,
  SETTINGS_KEY,
} from "./settings";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe("行番号（TASKS 7-4）", () => {
  it("test_既定は出さない（ふだんは要らない）", () => {
    expect(DEFAULT_SETTINGS.lineNumbers).toBe(false);
  });

  it("test_覚えて読み戻せる", () => {
    const storage = fakeStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, lineNumbers: true });
    expect(loadSettings(storage).lineNumbers).toBe(true);
  });

  it("test_壊れた値なら既定に落ちる", () => {
    const storage = fakeStorage();
    storage.setItem("oboegaki.settings", '{"lineNumbers":"はい"}');
    expect(loadSettings(storage).lineNumbers).toBe(false);
  });
});

describe("loadSettings", () => {
  it("test_記憶が無ければ既定", () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("test_保存した値を読み戻す", () => {
    const storage = fakeStorage();
    const mine = {
      ...DEFAULT_SETTINGS,
      theme: "dark" as const,
      contentWidth: "wide" as const,
      historyMinutes: 15,
      trashDays: 7,
      listWidth: 300,
      notesVisible: false,
    };
    saveSettings(storage, mine);
    expect(loadSettings(storage)).toEqual(mine);
  });

  it("test_ペインの幅は範囲に丸める", () => {
    // 幅は丸めてよい（狭すぎ・広すぎは見た目の問題で、失うものが無い）
    const storage = fakeStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, listWidth: 10 });
    expect(loadSettings(storage).listWidth).toBe(MIN_PANE_WIDTH);
    saveSettings(storage, { ...DEFAULT_SETTINGS, listWidth: 9999 });
    expect(loadSettings(storage).listWidth).toBe(MAX_PANE_WIDTH);
    expect(clampPaneWidth(Number.NaN)).toBe(DEFAULT_SETTINGS.listWidth);
  });

  it("test_ペインの開閉は真偽値として読む", () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: '{"notesVisible":"はい","treesVisible":false}',
    });
    const found = loadSettings(storage);
    expect(found.notesVisible).toBe(DEFAULT_SETTINGS.notesVisible);
    expect(found.treesVisible).toBe(false);
  });

  it("test_壊れた値は既定へ落とす", () => {
    // 設定ファイルは手で編集できる。読めない値でアプリを止めない
    const storage = fakeStorage({
      [SETTINGS_KEY]:
        '{"theme":"虹","contentWidth":9,"historyMinutes":7,"trashDays":-3}',
    });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("test_壊れた JSON でも既定で開く", () => {
    const storage = fakeStorage({ [SETTINGS_KEY]: "{ではない" });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("test_ゴミ箱の日数が範囲の外なら既定へ", () => {
    // **小さい側へ丸めない。** 壊れた値が「1 日で消す」という取り返しの
    // つかない設定に化ける
    const storage = fakeStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, trashDays: 9999 });
    expect(loadSettings(storage).trashDays).toBe(DEFAULT_SETTINGS.trashDays);
    saveSettings(storage, { ...DEFAULT_SETTINGS, trashDays: 0 });
    expect(loadSettings(storage).trashDays).toBe(DEFAULT_SETTINGS.trashDays);
  });

  it("test_履歴の間隔は選べる値だけ", () => {
    // 「なし」（0）も選べる。自分で保存したときだけ残す
    expect(HISTORY_CHOICES).toContain(0);
    expect(HISTORY_CHOICES).toContain(DEFAULT_SETTINGS.historyMinutes);
  });
});

describe("ローカルLLM の設定（ADR-0025）", () => {
  it("test_モデル名は空にできない（押しても何も起きないアプリにしない）", () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: '{"llmModel":"   "}',
    });
    expect(loadSettings(storage).llmModel).toBe(DEFAULT_SETTINGS.llmModel);
  });

  it("test_ポートと待ち時間は範囲の外なら既定へ", () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: '{"llmPort":0,"llmTimeoutMinutes":999}',
    });
    const found = loadSettings(storage);
    expect(found.llmPort).toBe(DEFAULT_SETTINGS.llmPort);
    expect(found.llmTimeoutMinutes).toBe(DEFAULT_SETTINGS.llmTimeoutMinutes);
  });

  it("test_生成AIへ渡す前の確認は既定で入り", () => {
    // ノートの中身が外へ出る操作なので、黙って出さない
    expect(DEFAULT_SETTINGS.confirmHandoff).toBe(true);
    const stored = loadSettings(
      fakeStorage({
        [SETTINGS_KEY]: JSON.stringify({ confirmHandoff: false }),
      }),
    );
    expect(stored.confirmHandoff).toBe(false);
  });

  it("test_PowerPoint のテンプレートの場所を覚える", () => {
    expect(DEFAULT_SETTINGS.slideTemplate).toBe("");
    const stored = loadSettings(
      fakeStorage({
        [SETTINGS_KEY]: JSON.stringify({ slideTemplate: "/v/社内.pptx" }),
      }),
    );
    expect(stored.slideTemplate).toBe("/v/社内.pptx");
  });

  it("test_アシスタントを使うかを覚える（既定は使う）", () => {
    // 切っておくと設定も畳み、Cmd+6 でも出さない（要望 2026-09-04）
    expect(DEFAULT_SETTINGS.assistantEnabled).toBe(true);
    const stored = (value: unknown) =>
      loadSettings(
        fakeStorage({
          [SETTINGS_KEY]: JSON.stringify({ assistantEnabled: value }),
        }),
      ).assistantEnabled;
    expect(stored(false)).toBe(false);
    // 壊れた値は既定へ（設定が読めないだけで機能が消えない）
    expect(stored("yes")).toBe(true);
  });

  it("test_送り先の設定は持たない（外へ出す道を作らない）", () => {
    // ADR-0025 決定 3。ここに host が生えたら設計が変わったということ
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain("llmHost");
  });
});

describe("resolveTheme", () => {
  it("test_システムなら今の見た目に従う", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("test_手で選んだらそちらが勝つ", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("contentWidthCss", () => {
  it("test_名前を幅に写す。最大は制限なし", () => {
    expect(contentWidthCss("standard")).toBe("46rem");
    expect(contentWidthCss("wide")).toBe("56rem");
    // 0 ではなく none。CSS の max-width にそのまま渡せる形で持つ
    expect(contentWidthCss("full")).toBe("none");
  });
});

describe("hitofude と揃える追加項目（2026-09-04）", () => {
  test("test_既定値", () => {
    expect(DEFAULT_SETTINGS.bodyFont).toBe("");
    expect(DEFAULT_SETTINGS.monoFont).toBe("");
    expect(DEFAULT_SETTINGS.tabWidth).toBe(4);
    expect(DEFAULT_SETTINGS.indentedCode).toBe(true);
    expect(DEFAULT_SETTINGS.lineSpacing).toBe("normal");
    expect(DEFAULT_SETTINGS.ocrEngine).toBe("mac");
  });

  test("test_保存して読み戻せる", () => {
    const storage = fakeStorage();
    saveSettings(storage, {
      ...DEFAULT_SETTINGS,
      bodyFont: "Hiragino Maru Gothic ProN",
      monoFont: "Menlo",
      tabWidth: 8,
      indentedCode: false,
      lineSpacing: "relaxed",
    });
    const loaded = loadSettings(storage);
    expect(loaded.bodyFont).toBe("Hiragino Maru Gothic ProN");
    expect(loaded.monoFont).toBe("Menlo");
    expect(loaded.tabWidth).toBe(8);
    expect(loaded.indentedCode).toBe(false);
    expect(loaded.lineSpacing).toBe("relaxed");
  });

  test("test_壊れた値は既定へ", () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        tabWidth: 99,
        lineSpacing: "huge",
        indentedCode: "yes",
        bodyFont: 5,
      }),
    });
    const loaded = loadSettings(storage);
    expect(loaded.tabWidth).toBe(4);
    expect(loaded.lineSpacing).toBe("normal");
    expect(loaded.indentedCode).toBe(true);
    expect(loaded.bodyFont).toBe("");
  });
});
