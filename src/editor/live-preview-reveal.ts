// リビール（何をいつ生に戻すか）の状態と述語。ソースモード / プレビューモード /
// 書き込んでいる行の StateField と、`touchesSelection`（プレビューモードの門を通す）
// `touchesBlockZone`（門を通さない。書く面を持たない widget 用）`touchesLine`。
// 19-2 で live-preview.ts から分けた

import { Decoration, EditorView } from "@codemirror/view";
import {
  type EditorState,
  type Range,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { unfoldAll } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { type MermaidTheme } from "./mermaid";

/// ソースモード（Cmd+/）。ON の間はすべてのライブプレビュー装飾を止めて
/// 生の Markdown を見せる（§6.4「全マーカー: ソースモード ON で常に全表示」）。
/// 図の見た目（ADR-0021）。**装飾の鍵に含める**ので StateField で持つ
/// （読むだけの DOM 参照にすると、テーマを変えても古い図が残る）。
export const setDiagramTheme = StateEffect.define<MermaidTheme>();

export const diagramThemeField = StateField.define<MermaidTheme>({
  create: () => "light",
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setDiagramTheme)) next = effect.value;
    }
    return next;
  },
});

export const setSourceMode = StateEffect.define<boolean>();
/// プレビューモード（ADR-0065。要望 2026-09-15。識別子は wysiwyg のまま）。ON の間はカーソルを置いた
/// だけでは記法を出さず、**書き込んでいる行だけ**出す。直しは書式ツール
/// バーの絵から行う前提
export const setWysiwyg = StateEffect.define<boolean>();

export const sourceModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setSourceMode)) next = effect.value;
      // プレビューモードとは排他（全部見せる／なるべく見せない、の両立はない）
      if (effect.is(setWysiwyg) && effect.value) next = false;
    }
    return next;
  },
});

export const wysiwygField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setWysiwyg)) next = effect.value;
      if (effect.is(setSourceMode) && effect.value) next = false;
    }
    return next;
  },
});

/// 書き込んでいる行（その行頭の位置）。プレビューモードで記法を出す唯一の行。
///
/// **書いたときだけ**その行になる（打つ・貼る・落とす・消す = userEvent の
/// `input.type` / `input.paste` / `input.drop` / `delete`）。カーソルを置いた
/// だけ・選んだだけでは変わらず、別の行へ移ると忘れる。書式ツールバーの
/// コマンドは userEvent が素の `"input"` で、`isUserEvent("input")` だと前方
/// 一致で拾ってしまう（棚卸し 2026-09-17）。ツールバーで直しても記法を出さない
/// のが ADR-0065 の狙いなので、字を打つ種類だけを数える
export const typingLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    const head = tr.state.selection.main.head;
    const headLine = tr.state.doc.lineAt(head).from;
    const typed =
      tr.isUserEvent("input.type") ||
      tr.isUserEvent("input.paste") ||
      tr.isUserEvent("input.drop") ||
      tr.isUserEvent("delete");
    if (tr.docChanged && typed) {
      return headLine;
    }
    if (value === null) return null;
    const mapped = tr.changes.mapPos(
      Math.min(value, tr.startState.doc.length),
      1,
    );
    const line = tr.state.doc.lineAt(
      Math.min(mapped, tr.state.doc.length),
    ).from;
    return line === headLine ? line : null;
  },
});

/// 見え方のモードが切り替わった transaction か（ソース／プレビュー）。
/// ブロックのウィジェット（表・図・数式・囲み）はこれだけを見る — それらは
/// 「書き込んでいる行」を見ないので、その移り変わりで数え直す理由が無い
/// （全行走査 + JSON.stringify が行を移るごとに走っていた。棚卸し 2026-09-17）
export function revealModeSwitched(tr: Transaction): boolean {
  return tr.effects.some((e) => e.is(setSourceMode) || e.is(setWysiwyg));
}

/// リビールの前提が変わった transaction か（インラインの装飾を作り直す合図）。
/// モードの切り替えと、プレビューモード中の「書き込んでいる行」の移り変わり
export function revealModeChanged(tr: Transaction): boolean {
  if (revealModeSwitched(tr)) {
    return true;
  }
  return (
    (tr.state.field(wysiwygField, false) ?? false) &&
    tr.startState.field(typingLineField, false) !==
      tr.state.field(typingLineField, false)
  );
}

export function toggleSourceMode(view: EditorView): boolean {
  const turningOn = !view.state.field(sourceModeField);
  view.dispatch({
    effects: setSourceMode.of(turningOn),
  });
  // ソースを全部見せるモードで隠れた行があっては嘘になる（ADR-0019）
  if (turningOn) unfoldAll(view);
  return true;
}

/// ソースモードが入ったか切れたか（**値で見る**）。ソース → プレビューでは
/// `setSourceMode` の効果が流れず、field の排他でソースが黙って切れる。効果
/// だけを見ていると装飾（太字・見出しの大きさ）を戻し忘れる（実機 2026-09-15）
export function sourceModeFlipped(
  start: EditorState,
  end: EditorState,
): boolean {
  return (
    (start.field(sourceModeField, false) ?? false) !==
    (end.field(sourceModeField, false) ?? false)
  );
}

/// プレビューモードの切り替え（ADR-0065）。ソースモードとの排他は field 側が持つ
export function toggleWysiwyg(view: EditorView): boolean {
  view.dispatch({
    effects: setWysiwyg.of(!view.state.field(wysiwygField)),
  });
  return true;
}

export function touchesSelection(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  if (state.field(wysiwygField, false)) {
    // プレビューモード（ADR-0065）: 書き込んでいる行だけ。カーソルを置いた
    // だけ・選んだだけでは現さない
    const typing = state.field(typingLineField, false) ?? null;
    if (typing === null) return false;
    const line = state.doc.lineAt(Math.min(typing, state.doc.length));
    if (to < line.from || from > line.to) return false;
  }
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/// 葉ブロック（表・フェンス）の子に置かれた引用の継続行の `> ` を隠す。
/// 行にカーソルがあるときは他の `> ` と同じく見せる
export function hideQuoteMarks(
  state: EditorState,
  node: SyntaxNode,
  out: Range<Decoration>[],
): void {
  for (const mark of node.getChildren("QuoteMark")) {
    if (touchesLine(state, mark.from)) continue;
    out.push(
      Decoration.replace({}).range(
        mark.from,
        withTrailingSpace(state, mark.to),
      ),
    );
  }
}

/// 選択がそのブロックの**ウィジェット**（表・図・数式・囲み）に触れているか。
/// これらは書く面を持たない（ウィジェットのまま直せない）ので、プレビュー
/// モードでも「書き込んでいる行」の規則を通さず、カーソルが入れば生に戻す
/// （インラインと同じ作法。実機 2026-09-15: 表のセルを直せなかった）
export function touchesBlockZone(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/// 選択がそのブロック（行）に触れているか。ブロック系マーカーのリビール条件。
export function touchesLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return touchesSelection(state, line.from, line.to);
}

/// 直後が空白なら 1 文字ぶん隠す範囲を広げる（`# ` `- ` `> ` の空白）。
export function withTrailingSpace(state: EditorState, end: number): number {
  return state.sliceDoc(end, end + 1) === " " ? end + 1 : end;
}
