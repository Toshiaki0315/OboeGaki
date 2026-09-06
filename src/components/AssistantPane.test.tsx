// @vitest-environment jsdom
// アシスタントのペイン（Cmd+6、ADR-0025）の検証。Ollama とのやり取りは
// App が持ち、ここは押せる・押せないと表示だけを見る。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssistantPane, type AssistantPaneProps } from "./AssistantPane";

afterEach(cleanup);

function setup(over: Partial<AssistantPaneProps> = {}) {
  const props: AssistantPaneProps = {
    hasNote: true,
    llmReady: true,
    thinking: false,
    answer: "",
    question: "",
    onQuestionChange: vi.fn(),
    sources: [],
    related: [],
    relatedShown: false,
    onStop: vi.fn(),
    onRelated: vi.fn(),
    onAsk: vi.fn(),
    onAskQuestion: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  render(<AssistantPane {...props} />);
  return props;
}

const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

describe("AssistantPane", () => {
  test("test_要約とレビューは押せて_止めるは考えていないときは押せない", () => {
    const props = setup();
    expect(button("要約").disabled).toBe(false);
    expect(button("止める").disabled).toBe(true);
    fireEvent.click(button("要約"));
    expect(props.onAsk).toHaveBeenCalledWith("summary");
  });

  test("test_考えている間は要約は押せず_止めるが押せる", () => {
    const props = setup({ thinking: true });
    expect(button("要約").disabled).toBe(true);
    fireEvent.click(button("止める"));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  test("test_L-3_関連は Ollama が無くても押せる_ノートが無ければ押せない", () => {
    const props = setup({ llmReady: false });
    expect(button("関連").disabled).toBe(false);
    fireEvent.click(button("関連"));
    expect(props.onRelated).toHaveBeenCalledTimes(1);
    cleanup();
    setup({ hasNote: false });
    expect(button("関連").disabled).toBe(true);
    expect(button("要約").disabled).toBe(true);
  });

  test("test_Ollama が無ければ入れ方を案内し_質問欄は出さない", () => {
    setup({ llmReady: false });
    expect(screen.getByText(/ollama\.com から入れて/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("ノート全体に質問する")).toBeNull();
  });

  test("test_質問は Enter で送り_変換中の Enter では送らない", () => {
    const props = setup({ question: "予算は？" });
    const input = screen.getByPlaceholderText("ノート全体に質問する");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(props.onAskQuestion).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onAskQuestion).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "予算はいくら？" } });
    expect(props.onQuestionChange).toHaveBeenCalledWith("予算はいくら？");
  });

  test("test_空の質問では送るボタンが押せない", () => {
    setup({ question: "   " });
    expect(button("質問").disabled).toBe(true);
    cleanup();
    setup({ question: "予算" });
    expect(button("質問").disabled).toBe(false);
  });

  test("test_案内は答えが出るまで_読んだノートはそのまま出す", () => {
    const props = setup({
      answer: "決まったのは…",
      sources: [{ path: "a.md", title: "予算会議", snippet: "" }],
    });
    expect(screen.queryByText(/要約とレビューはこのノートだけ/)).toBeNull();
    expect(screen.getByText("決まったのは…")).toBeTruthy();
    fireEvent.click(screen.getByText("予算会議"));
    expect(props.onOpen).toHaveBeenCalledWith("a.md");
  });

  test("test_考えている間は「考えています…」", () => {
    setup({ thinking: true });
    expect(screen.getByText("考えています…")).toBeTruthy();
  });

  test("test_関連は理由ごと出し_無ければ結び方を案内", () => {
    const props = setup({
      relatedShown: true,
      related: [
        { path: "b.md", title: "計画", reasons: ["同じタグ", "リンク"] },
      ],
    });
    expect(screen.getByText("同じタグ / リンク")).toBeTruthy();
    fireEvent.click(screen.getByText("計画"));
    expect(props.onOpen).toHaveBeenCalledWith("b.md");
    cleanup();
    setup({ relatedShown: true, related: [] });
    expect(screen.getByText(/関連するノートはありません/)).toBeTruthy();
  });
});
