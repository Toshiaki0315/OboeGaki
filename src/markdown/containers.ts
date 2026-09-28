// `:::` の囲み（`:::note` / `:::details` / `:::center` / `:::right`）の綴りと
// 見つけ方（ADR-0067 / ADR-0069）。CM6 に依存しない純関数。画面（editor の
// live-preview-zones・note-container・details-container）とスライド（lib/slides）
// が同じ規則を読む。
//
// **行頭から始まるものだけ**を見る（字下げされた `:::` はコード例）。

/// `:::note` と種類 1 語まで（`:::note warn extra` は囲みにしない）
export const NOTE_OPEN_RE = /^:::note(?:[ \t]+(\S+))?[ \t]*$/;
/// `:::details` と呼び名（何語でもよい）
export const DETAILS_OPEN_RE = /^:::details(?:[ \t]+(.*?))?[ \t]*$/;
/// 段落と見出しを寄せる囲み（ADR-0069）。語は付けない（`:::center 題` は囲みに
/// しない）。`:::left` は置かない — 入れ子が無いので囲みの中の既定は常に左
export const ALIGN_OPEN_RE = /^:::(center|right)[ \t]*$/;
/// 閉じの `:::`
export const CONTAINER_CLOSE_RE = /^:::[ \t]*$/;

/// 寄せの HTML の開きの行（ADR-0069 の決定 6。**読むときだけ受ける**）。
/// `<div align="center">`・`<p align='right'>`・`<div style="text-align: center;">`
/// の形だけ。属性は 1 つだけ（`class` などが付いたものは受けない = 狭く見分ける）
export const ALIGN_HTML_OPEN_RE =
  /^<(div|p)\s+(?:align\s*=\s*(["'])(center|right)\2|style\s*=\s*(["'])\s*text-align\s*:\s*(center|right)\s*;?\s*\4)\s*>[ \t]*$/i;
/// 1 行の形（`<p align="center">題</p>`。23-2 後半）。属性の規則は開きの行と同じ。
/// 中身が空のものは受けない
const ALIGN_HTML_LINE_RE =
  /^<(div|p)\s+(?:align\s*=\s*(["'])(center|right)\2|style\s*=\s*(["'])\s*text-align\s*:\s*(center|right)\s*;?\s*\4)\s*>(.*?\S.*?)<\/\1>[ \t]*$/i;

export type ColonContainer = {
  kind: "note" | "details" | "center" | "right";
  /// 開きの行（0 始まり）
  open: number;
  /// 閉じの行（0 始まり）
  close: number;
  /// note の種類・details の呼び名（書いていなければ空）
  info: string;
  /// 書き方。`html` は寄せの HTML（`<div align="center">` … `</div>`。23-2）
  form: "colon" | "html";
  /// 1 行の形（`<p align="center">題</p>`）なら、その行の中の中身の位置
  /// （開きのタグの後ろから閉じのタグの前まで。open と close は同じ行）
  inline?: { from: number; to: number };
};

/// 行の並びから `:::` の囲みを出てくる順に返す。
///
/// - **閉じが無ければ囲みにしない**（書きかけで以降が全部囲みになると読めない）
/// - **入れ子は見ない。** 開いている間の開きは囲みにせず字のまま残す
///   （ADR-0069 の決定 3）。最初の `:::` が開いている囲みを閉じる
/// - `isCode` が真の行（フェンスやインデントのコードの中）は開きにも閉じにも
///   数えない。コード例の `:::` で囲みの対が崩れない
export function colonContainers(
  lines: Iterable<string>,
  isCode: (index: number) => boolean = () => false,
): ColonContainer[] {
  const found: ColonContainer[] = [];
  let open: Opened | null = null;
  let index = -1;
  for (const text of lines) {
    index += 1;
    // 行頭が `:` でも `<` でもない行は正規表現に掛けない（全行走査なので）
    const first = text.charCodeAt(0);
    if ((first !== 58 && first !== 60) || isCode(index)) continue;
    if (open === null && first === 60) {
      const line = ALIGN_HTML_LINE_RE.exec(text);
      if (line) {
        const content = line[6];
        const from = text.indexOf(">") + 1;
        found.push({
          kind: (line[3] ?? line[5]).toLowerCase() as "center" | "right",
          open: index,
          close: index,
          info: "",
          form: "html",
          inline: { from, to: from + content.length },
        });
        continue;
      }
    }
    if (open !== null) {
      if (closes(open, text)) {
        const { tag: _tag, ...entry } = open;
        found.push({ ...entry, close: index });
        open = null;
      }
      continue; // 開いている間の開きは囲みにしない（入れ子を許さない）
    }
    open = openedAt(text, index);
  }
  return found; // 閉じの無い開きは捨てる
}

/// 開いている囲み。HTML の形は閉じのタグ（`div` / `p`）を覚える
type Opened = Omit<ColonContainer, "close"> & { tag?: string };

/// その行が開いている囲みを閉じるか。`:::` の囲みは `:::`、HTML の寄せは同じ
/// タグの閉じ（`</div>` / `</p>`）だけ — HTML の中の `:::` は字のまま
function closes(open: Opened, text: string): boolean {
  if (open.form === "colon") return CONTAINER_CLOSE_RE.test(text);
  const found = /^<\/(div|p)>[ \t]*$/i.exec(text);
  return found !== null && found[1].toLowerCase() === open.tag;
}

/// その行が囲みの開きなら、種類と添え書き。開きでなければ null
function openedAt(text: string, index: number): Opened | null {
  if (text.charCodeAt(0) === 60) {
    const html = ALIGN_HTML_OPEN_RE.exec(text);
    if (!html) return null;
    const kind = (html[3] ?? html[5]).toLowerCase() as "center" | "right";
    return {
      kind,
      open: index,
      info: "",
      form: "html",
      tag: html[1].toLowerCase(),
    };
  }
  const note = NOTE_OPEN_RE.exec(text);
  if (note) {
    return { kind: "note", open: index, info: note[1] ?? "", form: "colon" };
  }
  const details = DETAILS_OPEN_RE.exec(text);
  if (details) {
    return {
      kind: "details",
      open: index,
      info: details[1]?.trim() ?? "",
      form: "colon",
    };
  }
  const align = ALIGN_OPEN_RE.exec(text);
  if (align) {
    return {
      kind: align[1] as "center" | "right",
      open: index,
      info: "",
      form: "colon",
    };
  }
  return null;
}
