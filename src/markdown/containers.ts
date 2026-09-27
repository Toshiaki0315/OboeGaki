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

export type ColonContainer = {
  kind: "note" | "details" | "center" | "right";
  /// 開きの行（0 始まり）
  open: number;
  /// 閉じの行（0 始まり）
  close: number;
  /// note の種類・details の呼び名（書いていなければ空）
  info: string;
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
  let open: Omit<ColonContainer, "close"> | null = null;
  let index = -1;
  for (const text of lines) {
    index += 1;
    // 行頭が `:` でない行は正規表現に掛けない（全行走査なので）
    if (text.charCodeAt(0) !== 58 || isCode(index)) continue;
    if (open !== null) {
      if (CONTAINER_CLOSE_RE.test(text)) {
        found.push({ ...open, close: index });
        open = null;
      }
      continue; // 開いている間の開きは囲みにしない（入れ子を許さない）
    }
    open = openedAt(text, index);
  }
  return found; // 閉じの無い開きは捨てる
}

/// その行が囲みの開きなら、種類と添え書き。開きでなければ null
function openedAt(
  text: string,
  index: number,
): Omit<ColonContainer, "close"> | null {
  const note = NOTE_OPEN_RE.exec(text);
  if (note) return { kind: "note", open: index, info: note[1] ?? "" };
  const details = DETAILS_OPEN_RE.exec(text);
  if (details) {
    return { kind: "details", open: index, info: details[1]?.trim() ?? "" };
  }
  const align = ALIGN_OPEN_RE.exec(text);
  if (align) {
    return { kind: align[1] as "center" | "right", open: index, info: "" };
  }
  return null;
}
