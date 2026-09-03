// Cmd+クリックの判定と配線（ADR-0010/0011）。参照実装 core/activation.py の移植。
//
// 素のクリックはキャレットの移動が最優先（ADR-0010）。タグもリンクも
// Cmd+クリックに統一する。判定は EditorState だけで動く純関数に置き、
// 何を起こすか（開く・絞り込む）はアプリ側が Facet で注入する。

import { EditorView } from "@codemirror/view";
import { Facet, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export type Activation =
  | { kind: "link"; payload: string } // 既定のブラウザで開く
  | { kind: "tag"; payload: string } // そのタグで一覧を絞り込む
  | { kind: "note"; payload: string }; // そのノートを開く（無ければ作る）

// 本文に仕込んだものが動く。相対パスは vault 内の参照であって
// ブラウザへ渡すものではない（参照実装 _is_openable と同じ）
const ALLOWED_SCHEMES = /^(https?:\/\/|mailto:)/i;

export function activationAt(
  state: EditorState,
  pos: number,
): Activation | null {
  for (
    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
      state,
    ).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    switch (node.name) {
      case "Hashtag": {
        if (pos >= node.to) return null; // 範囲は [start, end)
        const name = state.sliceDoc(node.from + 1, node.to);
        return { kind: "tag", payload: name.toLowerCase() };
      }
      case "WikiLink": {
        const name = state.sliceDoc(node.from + 2, node.to - 2).trim();
        return { kind: "note", payload: name };
      }
      case "BareURL": {
        if (pos >= node.to) return null;
        const url = state.sliceDoc(node.from, node.to);
        return ALLOWED_SCHEMES.test(url)
          ? { kind: "link", payload: url }
          : null;
      }
      case "Link":
      case "Autolink": {
        const urlNode = node.getChild("URL");
        if (!urlNode) return null;
        const url = state.sliceDoc(urlNode.from, urlNode.to).trim();
        return ALLOWED_SCHEMES.test(url)
          ? { kind: "link", payload: url }
          : null;
      }
      case "Image":
        return null; // 画像は開かない（参照実装と同じ）
    }
  }
  return null;
}

/// 何を起こすかはアプリ側の持ち物（ノートを開く・検索を絞る・URL を開く）。
export const activationHandler = Facet.define<
  (action: Activation) => void,
  (action: Activation) => void
>({
  combine: (values) => values[0] ?? (() => {}),
});

/// Cmd+クリックで activation を発火させる。判定が無ければ通常のクリック。
export const activationClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.metaKey || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const found = activationAt(view.state, pos);
    if (!found) return false;
    event.preventDefault();
    view.state.facet(activationHandler)(found);
    return true; // キャレットは動かさない
  },
});
