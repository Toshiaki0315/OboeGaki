// 描くだけの widget（点・折りたたみの見出し・ファイル名・水平線・Setext の線）の
// 共通の振る舞い（19-3）。**押すとキャレットが置かれる**（ignoreEvent が false）—
// 水平線と Setext の線はプレビューモードでもカーソルで生に戻すと決めた（2026-09-17）
// のに、CM6 の既定（イベントを渡さない）のままでマウスでは戻せなかった

import { describe, expect, test } from "vitest";
import {
  BulletWidget,
  FileNameWidget,
  HrWidget,
  SetextRuleWidget,
  SummaryWidget,
} from "./live-preview-widgets";

describe("描くだけの widget", () => {
  test("test_押すとキャレットが置かれる_ignoreEvent_が_false", () => {
    const down = new Event("mousedown");
    for (const widget of [
      new BulletWidget("●"),
      new SummaryWidget("詳細"),
      new FileNameWidget("a.py"),
      new HrWidget(),
      new SetextRuleWidget(),
    ]) {
      expect(widget.ignoreEvent(down)).toBe(false);
    }
  });

  test("test_eq_は字面で決まる", () => {
    expect(new BulletWidget("●").eq(new BulletWidget("●"))).toBe(true);
    expect(new BulletWidget("●").eq(new BulletWidget("○"))).toBe(false);
    expect(new FileNameWidget("a").eq(new FileNameWidget("b"))).toBe(false);
    expect(new HrWidget().eq(new HrWidget())).toBe(true);
    // Setext の線はテストの simplify が `rule` で見分ける
    expect(new SetextRuleWidget().rule).toBe(true);
  });
});
