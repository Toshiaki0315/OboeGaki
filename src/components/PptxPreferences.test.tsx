// @vitest-environment jsdom
// 環境設定「PowerPoint」タブ（ADR-0046 / TASKS 第 8 群）の検証。

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_PPTX_SETTINGS } from "../lib/pptx-settings";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { PptxPreferences, type PptxPreferencesProps } from "./PptxPreferences";

function setup(over: Partial<PptxPreferencesProps> = {}) {
  const props: PptxPreferencesProps = {
    settings: DEFAULT_SETTINGS,
    onChangeSettings: vi.fn(),
    onChooseSlideTemplate: vi.fn(),
    pptxSettings: DEFAULT_PPTX_SETTINGS,
    onChangePptxSettings: vi.fn(),
    onResetPptxSettings: vi.fn(),
    noteText: null,
    ...over,
  };
  render(<PptxPreferences {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PptxPreferences", () => {
  test("test_CFG-01_用紙を変えると page.preset が変わる", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("大きさ"), {
      target: { value: "4:3" },
    });
    expect(props.onChangePptxSettings).toHaveBeenCalledWith({
      page: { ...DEFAULT_PPTX_SETTINGS.page, preset: "4:3" },
    });
  });

  test("test_CFG-02_「自分で決める」のときだけ幅と高さの欄が出る", () => {
    setup();
    expect(screen.queryByText("幅と高さ（インチ）")).toBeNull();
    setup({
      pptxSettings: {
        ...DEFAULT_PPTX_SETTINGS,
        page: { ...DEFAULT_PPTX_SETTINGS.page, preset: "custom" },
      },
    });
    expect(screen.getByText("幅と高さ（インチ）")).toBeTruthy();
  });

  test("test_PV-04_プレビューは 200ms 置いてから組む", () => {
    vi.useFakeTimers();
    setup();
    expect(screen.queryByRole("img")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole("img")).toBeTruthy();
  });

  test("test_PV-03_ノートを開いていなければ「このノート」は押せない", () => {
    vi.useFakeTimers();
    setup({ noteText: null });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(
      (screen.getByRole("button", { name: "このノート" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("test_GR-05_今のノートが収まらなければ枚数で知らせる", () => {
    const long = "とても長い文を延々と続けて枠から溢れさせる。".repeat(80);
    setup({ noteText: () => `# 題\n\n## 本文\n\n${long}\n` });
    expect(screen.getByText(/で文字が収まらないかもしれません/)).toBeTruthy();
  });

  test("test_CFG-17_見出しの色をテーマから外すと色の欄が出る", () => {
    const props = setup();
    expect(screen.queryByText("色を選ぶ")).toBeNull();
    fireEvent.click(screen.getByLabelText(/テーマに従う/));
    expect(props.onChangePptxSettings).toHaveBeenCalledWith({
      theme: {
        ...DEFAULT_PPTX_SETTINGS.theme,
        palette: {
          ...DEFAULT_PPTX_SETTINGS.theme.palette,
          accent: { hex: "1E2761" },
        },
      },
    });
  });
});
