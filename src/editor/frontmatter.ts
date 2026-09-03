// front matter の完全隠蔽と編集ガード（TASKS 2-2、ADR-0013）。
//
// front matter は**どのモードでも表示しない**（ソースモードでも出さない）。
// id / created / modified はアプリの管理情報で、書く人が触るものではない。
// 誤って消すと ULID による同一性（改名耐性）が失われるため、ユーザーの
// 編集操作は front matter に届かないようガードする。プログラムからの
// 書き換え（外部リロード・履歴の書き戻し）は userEvent を持たないので通す。
//
// メタデータが壊れていても本文は必ず開ける（G3）— 解釈は最小限の
// `key: スカラー` だけにとどめ、読めない行は黙って飛ばす。

import {
  EditorSelection,
  EditorState,
  StateField,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export type FrontMatterRange = {
  from: 0;
  to: number;
  /** 本文の開始位置（閉じ区切りの改行の次。無ければ文書末） */
  bodyStart: number;
};

// 1 行目がちょうど `---` で始まり、行頭の `---` で閉じられている場合だけ
// front matter（参照実装 _FRONT_MATTER_RE と同じ規則）。
// 閉じが無いものは「ただの水平線で始まる本文」。
const FRONT_MATTER_RE = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?=\n|$)/;

export function frontMatterRange(text: string): FrontMatterRange | null {
  if (!text.startsWith("---")) return null;
  const found = FRONT_MATTER_RE.exec(text);
  if (!found) return null;
  const to = found[0].length;
  return { from: 0, to, bodyStart: Math.min(to + 1, text.length) };
}

/// front matter の `key: スカラー` を読む。true/false・数値・引用符付き
/// 文字列・素の文字列だけ。入れ子や配列など読めないものは黙って飛ばす。
export function parseFrontMatterMeta(text: string): Record<string, unknown> {
  const range = frontMatterRange(text);
  if (!range) return {};
  const meta: Record<string, unknown> = {};
  for (const line of text.slice(4, range.to - 3).split("\n")) {
    const found = /^([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line);
    if (!found) continue;
    const [, key, raw] = found;
    if (raw === "true") meta[key] = true;
    else if (raw === "false") meta[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) meta[key] = Number(raw);
    else if (/^".*"$/.test(raw) || /^'.*'$/.test(raw))
      meta[key] = raw.slice(1, -1);
    else meta[key] = raw;
  }
  return meta;
}

/// 現在の front matter の範囲。本文だけの編集では再走査せず位置を写す。
export const frontMatterField = StateField.define<FrontMatterRange | null>({
  create: (state) => frontMatterRange(state.doc.toString()),
  update(value, tr) {
    if (!tr.docChanged) return value;
    // front matter とその直後に触れない編集なら、位置はそのまま
    //（from は常に 0 なので写す必要も無い）
    if (value && !tr.changes.touchesRange(0, value.to + 1)) return value;
    if (!value && !tr.changes.touchesRange(0, 4)) return null;
    return frontMatterRange(tr.newDoc.toString());
  },
  provide: (field) =>
    EditorView.decorations.from(field, (range) => {
      if (!range) return Decoration.none;
      return Decoration.set([
        Decoration.replace({ block: true }).range(range.from, range.to),
      ]);
    }),
});

// ユーザーの編集・選択を front matter に触れさせない。
// - 変更: front matter に食い込む input/delete は丸ごと取り消す
// - 選択: 範囲へ入ろうとしたら本文の先頭へ丸める（Cmd+A も本文だけになる）
const guard = EditorState.transactionFilter.of((tr) => {
  const range = tr.startState.field(frontMatterField);
  if (!range) return tr;

  const isEdit = tr.isUserEvent("input") || tr.isUserEvent("delete");
  if (isEdit && tr.docChanged) {
    let touches = false;
    tr.changes.iterChangedRanges((fromA) => {
      if (fromA < range.bodyStart) touches = true;
    });
    if (touches) return [];
  }

  if (tr.selection && tr.selection.main.from < range.bodyStart) {
    // 文書が変わる transaction はここへ来ない（上のガードで止まるか、
    // プログラム由来なので触らない）。座標は startState のままでよい
    if (!tr.docChanged) {
      const clamped = EditorSelection.create(
        tr.selection.ranges.map((r) =>
          EditorSelection.range(
            Math.max(r.anchor, range.bodyStart),
            Math.max(r.head, range.bodyStart),
          ),
        ),
        tr.selection.mainIndex,
      );
      return [tr, { selection: clamped, sequential: true }];
    }
  }
  return tr;
});

export const frontMatterHide: Extension = [frontMatterField, guard];
