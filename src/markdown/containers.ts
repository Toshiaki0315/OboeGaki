// `:::` の囲み（`:::note` / `:::details`）の綴りと見つけ方（ADR-0067 /
// ADR-0069）。CM6 に依存しない純関数。画面（editor/note-container・
// details-container）とスライド（lib/slides）が同じ綴りの規則を読む。
//
// **行頭から始まるものだけ**を見る（字下げされた `:::` はコード例）。

/// `:::note` と種類 1 語まで（`:::note warn extra` は囲みにしない）
export const NOTE_OPEN_RE = /^:::note(?:[ \t]+(\S+))?[ \t]*$/;
/// `:::details` と呼び名（何語でもよい）
export const DETAILS_OPEN_RE = /^:::details(?:[ \t]+(.*?))?[ \t]*$/;
/// 閉じの `:::`
export const CONTAINER_CLOSE_RE = /^:::[ \t]*$/;

export type ColonContainer = {
  kind: "note" | "details";
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
  lines: readonly string[],
  isCode: (index: number) => boolean = () => false,
): ColonContainer[] {
  const found: ColonContainer[] = [];
  let open: Omit<ColonContainer, "close"> | null = null;
  lines.forEach((text, index) => {
    // 行頭が `:` でない行は正規表現に掛けない（全行走査なので）
    if (text.charCodeAt(0) !== 58 || isCode(index)) return;
    if (open === null) {
      const note = NOTE_OPEN_RE.exec(text);
      if (note) {
        open = { kind: "note", open: index, info: note[1] ?? "" };
        return;
      }
      const details = DETAILS_OPEN_RE.exec(text);
      if (details) {
        open = { kind: "details", open: index, info: details[1]?.trim() ?? "" };
      }
    } else if (CONTAINER_CLOSE_RE.test(text)) {
      found.push({ ...open, close: index });
      open = null;
    }
  });
  return found;
}
