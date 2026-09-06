// @vitest-environment jsdom
// 文体を見る（U-4）の窓の検証。指摘するだけで直さない。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Finding } from "../lib/style-check";
import { StyleCheckDialog } from "./StyleCheckDialog";

afterEach(cleanup);

const TEXT = "とてもとても長い。   \n";
const FINDINGS: Finding[] = [
  { start: 0, length: 8, kind: "redundant", message: "重ねすぎです" },
  { start: 9, length: 3, kind: "long-sentence", message: "末尾に空白" },
];

function setup() {
  const onJump = vi.fn();
  const onClose = vi.fn();
  render(
    <StyleCheckDialog
      findings={FINDINGS}
      text={TEXT}
      onJump={onJump}
      onClose={onClose}
    />,
  );
  return { onJump, onClose };
}

describe("StyleCheckDialog", () => {
  test("test_件数と_該当の字と_どう書けるかを出す", () => {
    setup();
    expect(screen.getByText("文体を見る（2 件）")).toBeTruthy();
    expect(screen.getByText("とてもとても長い")).toBeTruthy();
    expect(screen.getByText("重ねすぎです")).toBeTruthy();
  });

  test("test_空白だけの箇所は（空白）と出す", () => {
    setup();
    expect(screen.getByText("（空白）")).toBeTruthy();
  });

  test("test_押すとその位置へ飛ぶ", () => {
    const { onJump } = setup();
    fireEvent.click(screen.getByText("末尾に空白"));
    expect(onJump).toHaveBeenCalledWith(9);
  });

  test("test_外側で閉じる", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
