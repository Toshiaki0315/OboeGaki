// @vitest-environment jsdom
// 環境設定「一般」タブ。状態は持たず、変更を親へ流すだけ — その流し方
//（項目名と値の型）を見る。棚卸し 2026-09-17 で足した。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  HISTORY_CHOICES,
  MAX_TRASH_DAYS,
  MIN_TRASH_DAYS,
} from "../lib/settings";
import {
  GeneralPreferences,
  type GeneralPreferencesProps,
} from "./GeneralPreferences";

function setup(over: Partial<GeneralPreferencesProps> = {}) {
  const props: GeneralPreferencesProps = {
    settings: DEFAULT_SETTINGS,
    onChangeSettings: vi.fn(),
    fontSize: 16,
    onChangeFontSize: vi.fn(),
    vaultRoot: "/vault",
    onChooseVault: vi.fn(),
    historyUsage: 2048,
    bodyFontChoices: [{ family: "Hiragino Sans", label: "ヒラギノ角ゴ" }],
    codeFontChoices: [],
    ...over,
  };
  render(<GeneralPreferences {...props} />);
  return props;
}

afterEach(cleanup);

describe("GeneralPreferences", () => {
  test("test_select_の変更は項目名つきで親へ", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText(/テーマ/), {
      target: { value: "dark" },
    });
    fireEvent.change(screen.getByLabelText(/行間/), {
      target: { value: "relaxed" },
    });
    fireEvent.change(screen.getByLabelText(/本文の幅/), {
      target: { value: "wide" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ theme: "dark" });
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      lineSpacing: "relaxed",
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      contentWidth: "wide",
    });
  });

  test("test_履歴の「なし」は数の_0_で渡る（捨てられない入口）", () => {
    const props = setup();
    const select = screen.getByLabelText(/履歴を残す間隔/);
    expect(screen.getByRole("option", { name: "なし" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "0" } });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ historyMinutes: 0 });
    expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(
      HISTORY_CHOICES.length,
    );
  });

  test("test_数の欄は数で渡り_範囲を属性で持つ", () => {
    const props = setup();
    const trash = screen.getByLabelText(/ゴミ箱の保持/) as HTMLInputElement;
    expect(trash.min).toBe(String(MIN_TRASH_DAYS));
    expect(trash.max).toBe(String(MAX_TRASH_DAYS));
    fireEvent.change(trash, { target: { value: "45" } });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ trashDays: 45 });
    fireEvent.change(screen.getByLabelText(/文字サイズ/), {
      target: { value: "18" },
    });
    expect(props.onChangeFontSize).toHaveBeenCalledWith(18);
    fireEvent.change(screen.getByLabelText(/タブ幅/), {
      target: { value: "8" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ tabWidth: 8 });
  });

  test("test_チェックとショートカット", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText(/字下げ/));
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      indentedCode: !DEFAULT_SETTINGS.indentedCode,
    });
    fireEvent.click(screen.getByLabelText(/行番号/));
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      lineNumbers: !DEFAULT_SETTINGS.lineNumbers,
    });
    fireEvent.change(screen.getByLabelText("書き取りのショートカット"), {
      target: { value: "Alt+Space" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      captureShortcut: "Alt+Space",
    });
  });

  test("test_保管フォルダは読むだけ_変更は親に任せる", () => {
    const props = setup({ vaultRoot: null });
    const field = screen.getByLabelText(/保管フォルダ/) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.readOnly).toBe(true);
    fireEvent.click(screen.getByText("変更…"));
    expect(props.onChooseVault).toHaveBeenCalledTimes(1);
  });

  test("test_履歴の使用量の見せ方（計算中・KB・MB）", () => {
    setup({ historyUsage: null });
    expect(screen.getByText("計算中…")).toBeTruthy();
    cleanup();
    setup({ historyUsage: 1536 });
    expect(screen.getByText("2KB")).toBeTruthy();
    cleanup();
    setup({ historyUsage: 3 * 1024 * 1024 });
    expect(screen.getByText("3.0MB")).toBeTruthy();
  });

  test("test_フォントの候補は_datalist_に並ぶ", () => {
    setup();
    expect(
      document.querySelector("#body-fonts option[value='Hiragino Sans']"),
    ).not.toBeNull();
  });
});
