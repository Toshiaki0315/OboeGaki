// @vitest-environment jsdom
// スライドの下絵（環境設定 PowerPoint タブのプレビュー）の検証。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_PPTX_SETTINGS } from "../lib/pptx-settings";
import { previewOf, SAMPLE_DECKS } from "../lib/slide-preview";
import { SlidePreview } from "./SlidePreview";

afterEach(cleanup);

describe("SlidePreview", () => {
  test("test_枚の題名を読み上げ名にした絵になる", () => {
    const view = previewOf(SAMPLE_DECKS[0].markdown, DEFAULT_PPTX_SETTINGS);
    render(<SlidePreview page={view.pages[0]} view={view} />);
    expect(
      screen.getByRole("img", { name: `${view.pages[0].title} のプレビュー` }),
    ).toBeTruthy();
  });

  test("test_紙の縦横比は用紙に従う", () => {
    const view = previewOf(SAMPLE_DECKS[0].markdown, DEFAULT_PPTX_SETTINGS);
    render(<SlidePreview page={view.pages[0]} view={view} />);
    const height = (100 * view.heightIn) / view.widthIn;
    expect(screen.getByRole("img").getAttribute("viewBox")).toBe(
      `0 0 100 ${height}`,
    );
  });
});
