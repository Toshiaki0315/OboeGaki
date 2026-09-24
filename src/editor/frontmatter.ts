// front matter の完全隠蔽と編集ガード（TASKS 2-2、ADR-0013）。
//
// front matter は**どのモードでも表示しない**（ソースモードでも出さない）。
// `pinned` や `title` などはアプリと書き出しが読む管理情報で、書く人が本文の
// つもりで触るものではない。誤って崩すとピン留めや表題が外れるため、
// ユーザーの編集操作は front matter に届かないようガードする（同一性は
// ULID ではなくパスが鍵 = ADR-0042。棚卸し 2026-09-17 に書き直した）。プログラムからの
// 書き換え（外部リロード・履歴の書き戻し）は userEvent を持たないので通す。
//
// メタデータが壊れていても本文は必ず開ける（G3）— 解釈は最小限の
// `key: スカラー` だけにとどめ、読めない行は黙って飛ばす。

import {
  EditorSelection,
  EditorState,
  StateField,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import {
  frontMatterRange,
  type FrontMatterRange,
} from "../markdown/front-matter";

export const frontMatterField = StateField.define<FrontMatterRange | null>({
  create: (state) => frontMatterRange(state.doc.toString()),
  update(value, tr) {
    if (!tr.docChanged) return value;
    // front matter とその直後に触れない編集なら、位置はそのまま
    //（from は常に 0 なので写す必要も無い）。範囲は value.to まで —
    // to+1 にすると本文先頭への**挿入**（境界の点）まで「触れた」扱いに
    // なり、ノート冒頭で打つたびに全文を走査していた（レビュー 2026-09-04）
    if (value && !tr.changes.touchesRange(0, value.to)) return value;
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
    // 閉じ `---` の行に改行が無い（front matter だけの文書）と bodyStart は
    // 文書末 = 閉じ区切りの直後で、そこへの入力は `---a` と閉じ行に食い込む
    // （YAML が丸ごと本文化する。レビュー 2026-09-24 / 21-2）。改行を先に
    // 補ってから通す
    const bareClose = range.bodyStart === range.to;
    let patched: number | null = null;
    const kept: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA < range.bodyStart) touches = true;
      else if (bareClose && fromA === range.to && toA === range.to) {
        kept.push({ from: fromA, to: toA, insert: `\n${inserted}` });
        patched = fromA + 1 + inserted.length;
      } else kept.push({ from: fromA, to: toA, insert: inserted.toString() });
    });
    if (patched !== null) {
      return [
        {
          changes: kept,
          selection: EditorSelection.cursor(patched),
          userEvent: tr.annotation(Transaction.userEvent),
          scrollIntoView: true,
        },
      ];
    }
    if (touches) {
      // front matter に食い込む変更**だけ**を落とす。「すべて置換」は
      // 1 transaction に複数の変更を積むので、全体を破棄すると本文側の
      // 置換まで黙って消える（レビュー 2026-09-04）
      if (kept.length === 0) return [];
      return [
        { changes: kept, userEvent: tr.annotation(Transaction.userEvent) },
      ];
    }
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
