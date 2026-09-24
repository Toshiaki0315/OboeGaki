// markdown-it の行内トークン → Run 列（ADR-0068 / 19-5）。Word 書き出しが自前の
// style stack で TextRun を直に組んでいたのを、スライドと同じ Run（markdown/runs）
// に寄せた。run にならないもの（強制改行・画像）は別の断片で返し、出力側が扱う

import type { Run } from "../markdown/runs";
import { splitImageAlt } from "../markdown/image-size";
import type { markdownTokens } from "./export-html";
import { hexForPptx, parseColorSpan } from "./text-color";

type Token = ReturnType<typeof markdownTokens>[number];

export type InlinePiece =
  | { kind: "run"; run: Run }
  | { kind: "break" }
  | {
      kind: "image";
      src: string;
      alt: string;
      width?: number;
      height?: number;
    };

type Style = Omit<Run, "text">;

export function inlinePieces(inline: Token): InlinePiece[] {
  const out: InlinePiece[] = [];
  const stack: Style[] = [{}];
  const current = () => stack[stack.length - 1];
  const push = (patch: Style) => stack.push({ ...current(), ...patch });
  const pop = () => {
    if (stack.length > 1) stack.pop();
  };
  const text = (value: string, extra: Style = {}) => {
    // markdown-it は装飾の前後に空の text を出す。空の run は誰の役にも立たない
    if (!value) return;
    // undefined の項目は持たない（テストで形を比べやすく、出力側の分岐も素直）
    const style = Object.fromEntries(
      Object.entries({ ...current(), ...extra }).filter(
        ([, v]) => v !== undefined,
      ),
    ) as Style;
    out.push({ kind: "run", run: { text: value, ...style } });
  };
  for (const child of inline.children ?? []) {
    switch (child.type) {
      case "text":
        text(child.content);
        break;
      case "softbreak":
        text(" ");
        break;
      case "hardbreak":
        out.push({ kind: "break" });
        break;
      case "strong_open":
        push({ bold: true });
        break;
      case "em_open":
        push({ italic: true });
        break;
      case "s_open":
        push({ strike: true });
        break;
      case "mark_open":
        push({ highlight: true });
        break;
      case "link_open":
        push({ link: String(child.attrGet("href") ?? "") });
        break;
      case "color_span_open": {
        const parsed = parseColorSpan(String(child.attrGet("style") ?? ""));
        push({ color: parsed?.color ? hexForPptx(parsed.color) : undefined });
        break;
      }
      case "strong_close":
      case "em_close":
      case "s_close":
      case "mark_close":
      case "link_close":
      case "color_span_close":
        pop();
        break;
      case "code_inline":
        text(child.content, { code: true });
        break;
      case "html_inline":
        // 数式（元の LaTeX を等幅で）。やることの印（markdown-it-task-lists の
        // <input>）は ☐ / ☑ に。他の生 HTML はここに来ない（html: false）
        if (child.meta?.latex) text(String(child.meta.latex), { code: true });
        else if (/^<input\b/i.test(child.content)) {
          text(/\bchecked\b/i.test(child.content) ? "☑ " : "☐ ");
        }
        break;
      case "image": {
        const { alt, width, height } = splitImageAlt(child.content ?? "");
        out.push({
          kind: "image",
          src: String(child.attrGet("src") ?? ""),
          alt,
          width,
          height,
        });
        break;
      }
      case "footnote_ref": {
        // 脚注側（docx-blocks の footnote_open）と同じ決め方: label が無い行内脚注
        // `^[…]` は id（0 始まり）+ 1。以前は本文だけ [0] になっていた（21-3）
        const label = child.meta?.label as string | undefined;
        const id = child.meta?.id as number | undefined;
        text(`[${label ?? (id === undefined ? "*" : id + 1)}]`);
        break;
      }
      default:
        if (child.content) text(child.content);
    }
  }
  return out;
}
