// @vitest-environment jsdom
// 環境設定「アシスタント」タブ。変更の流し方（項目名と値の型）と、選択肢の
// 呼び名を見る。未インストール警告と fieldset の無効化は PreferencesDialog.test。

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CONTEXT_CHOICES, DEFAULT_SETTINGS } from "../lib/settings";
import {
  AssistantPreferences,
  type AssistantPreferencesProps,
} from "./AssistantPreferences";

function setup(over: Partial<AssistantPreferencesProps> = {}) {
  const props: AssistantPreferencesProps = {
    settings: { ...DEFAULT_SETTINGS, assistantEnabled: true },
    onChangeSettings: vi.fn(),
    installedModels: ["gemma3:4b"],
    ...over,
  };
  render(<AssistantPreferences {...props} />);
  return props;
}

describe("AssistantPreferences", () => {
  test("test_使うかどうかと外へ渡す前の確認はチェックで", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText(/AI アシスタントを使う/));
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      assistantEnabled: false,
    });
    fireEvent.click(screen.getByLabelText(/渡す前の確認/));
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      confirmHandoff: !DEFAULT_SETTINGS.confirmHandoff,
    });
  });

  test("test_ポートと待ち時間は数で渡る", () => {
    const props = setup();
    const port = screen.getByLabelText(/ポート/) as HTMLInputElement;
    expect(port.min).toBe("1");
    expect(port.max).toBe("65535");
    fireEvent.change(port, { target: { value: "11435" } });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ llmPort: 11435 });
    fireEvent.change(screen.getByLabelText(/応答待ち時間/), {
      target: { value: "5" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      llmTimeoutMinutes: 5,
    });
  });

  test("test_一度に渡す量は_k_トークンで見せ_数で渡る", () => {
    const props = setup();
    for (const tokens of CONTEXT_CHOICES) {
      expect(
        screen.getByRole("option", { name: `${tokens / 1024}k トークン` }),
      ).toBeTruthy();
    }
    fireEvent.change(screen.getByLabelText(/一度に渡す量/), {
      target: { value: "16384" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ llmContext: 16384 });
  });

  test("test_モデルを残す時間の呼び名", () => {
    const props = setup();
    expect(screen.getByRole("option", { name: "すぐ降ろす" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "5 分" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/モデルを残す時間/), {
      target: { value: "30m" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({
      llmKeepAlive: "30m",
    });
  });

  test("test_まだモデルを聞けていない（空）なら未インストールとは言わない", () => {
    setup({
      installedModels: [],
      settings: {
        ...DEFAULT_SETTINGS,
        assistantEnabled: true,
        llmModel: "なんでも",
      },
    });
    expect(screen.queryByText(/Ollama に入っていません/)).toBeNull();
  });

  test("test_文字の読み取りの選択", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText(/文字の読み取り/), {
      target: { value: "llm" },
    });
    expect(props.onChangeSettings).toHaveBeenCalledWith({ ocrEngine: "llm" });
  });
});
