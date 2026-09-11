// @vitest-environment jsdom
// 環境設定ダイアログ（TASKS 3-9）の殻 — タブ・キャンセル・OK の検証。
// 各タブの中身は GeneralPreferences / PptxPreferences / AssistantPreferences。

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_PPTX_SETTINGS } from "../lib/pptx-settings";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { PreferencesDialog, type PreferencesProps } from "./PreferencesDialog";

function setup(over: Partial<PreferencesProps> = {}) {
  const props: PreferencesProps = {
    settings: DEFAULT_SETTINGS,
    onChangeSettings: vi.fn(),
    fontSize: 16,
    onChangeFontSize: vi.fn(),
    vaultRoot: "/vault",
    onChooseVault: vi.fn(),
    onCopyMcpConfig: vi.fn(),
    onChooseSlideTemplate: vi.fn(),
    pptxSettings: DEFAULT_PPTX_SETTINGS,
    onChangePptxSettings: vi.fn(),
    onResetPptxSettings: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    noteText: null,
    historyUsage: () => Promise.resolve(2048),
    installedModels: () => Promise.resolve(["gemma3:4b"]),
    bodyFontChoices: [],
    codeFontChoices: [],
    ...over,
  };
  const view = render(<PreferencesDialog {...props} />);
  return { props, view };
}

afterEach(cleanup);

describe("PreferencesDialog", () => {
  test("test_開いた直後は「一般」で_履歴の使用量は読めたら出す", async () => {
    setup();
    expect(
      screen.getByRole("tab", { name: "一般", selected: true }),
    ).toBeTruthy();
    expect(screen.getByText("計算中…")).toBeTruthy();
    expect(await screen.findByText("2KB")).toBeTruthy();
  });

  test("test_使用量が読めなければ 0 として出す", async () => {
    setup({ historyUsage: () => Promise.reject(new Error("no vault")) });
    expect(await screen.findByText("0B")).toBeTruthy();
  });

  test("test_MCP_は別のタブに分ける_一般には出さない（使わない人が多い）", () => {
    setup();
    // 「一般」を開いた時点では MCP のものは 1 つも出さない
    expect(screen.queryByRole("button", { name: "設定をコピー" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    expect(screen.getByRole("button", { name: "設定をコピー" })).toBeTruthy();
  });

  test("test_MCP_の設定を押すと親に頼む（10-6）", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    fireEvent.click(screen.getByRole("button", { name: "設定をコピー" }));
    expect(props.onCopyMcpConfig).toHaveBeenCalled();
  });

  test("test_タブを押すとページが替わる", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "PowerPoint" }));
    expect(screen.getByText("用紙")).toBeTruthy();
    expect(screen.queryByText("本文フォント")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "アシスタント" }));
    expect(screen.getByText("AI アシスタントを使う")).toBeTruthy();
  });

  test("test_キャンセルは開いたときの設定と文字サイズへ戻して閉じる", () => {
    const { props, view } = setup();
    // 開いている間に触った（親の state が変わって流れてくる）
    view.rerender(
      <PreferencesDialog
        {...props}
        settings={{ ...DEFAULT_SETTINGS, theme: "dark" }}
        fontSize={20}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(props.onChangeSettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(props.onChangeFontSize).toHaveBeenCalledWith(16);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test("test_OK は閉じるだけ", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onChangeSettings).not.toHaveBeenCalled();
  });

  test("test_「デフォルトに戻す」は親に任せる", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "デフォルトに戻す" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test("test_外側を押すと閉じる", () => {
    const { props } = setup();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test("test_一般_本文フォントを変えると settings に流れる", () => {
    const { props } = setup();
    fireEvent.change(screen.getByPlaceholderText("システムの既定"), {
      target: { value: "Hiragino Sans" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      bodyFont: "Hiragino Sans",
    });
  });

  test("test_アシスタント_Ollama に無いモデル名なら知らせる", async () => {
    setup({ settings: { ...DEFAULT_SETTINGS, llmModel: "qwen3:8b" } });
    fireEvent.click(screen.getByRole("tab", { name: "アシスタント" }));
    expect(await screen.findByText("（Ollama に入っていません）")).toBeTruthy();
  });

  test("test_アシスタント_入っている名前なら何も言わない", async () => {
    const { view } = setup({
      settings: { ...DEFAULT_SETTINGS, llmModel: "gemma3:4b" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "アシスタント" }));
    await waitFor(() =>
      expect(view.container.querySelectorAll("datalist option")).toHaveLength(
        1,
      ),
    );
    expect(screen.queryByText("（Ollama に入っていません）")).toBeNull();
  });

  test("test_アシスタント_文字の読み取りは macOS とローカルLLM から選ぶ（ADR-0027）", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "アシスタント" }));
    const select = screen.getByLabelText("文字の読み取り") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "mac",
      "llm",
    ]);
    expect(select.value).toBe("mac");
    fireEvent.change(select, { target: { value: "llm" } });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ ocrEngine: "llm" });
  });

  test("test_アシスタント_切ってあれば欄をまとめて押せなくする", () => {
    const { view } = setup({
      settings: { ...DEFAULT_SETTINGS, assistantEnabled: false },
    });
    fireEvent.click(screen.getByRole("tab", { name: "アシスタント" }));
    const fieldset = view.container.querySelector("fieldset");
    expect(fieldset?.disabled).toBe(true);
  });
});
