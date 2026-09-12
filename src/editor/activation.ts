// Cmd+クリックの判定と配線（ADR-0010/0011）。参照実装 core/activation.py の移植。
//
// 素のクリックはキャレットの移動が最優先（ADR-0010）。タグもリンクも
// Cmd+クリックに統一する。判定は EditorState だけで動く純関数に置き、
// 何を起こすか（開く・絞り込む）はアプリ側が Facet で注入する。

import { EditorView, ViewPlugin, type PluginValue } from "@codemirror/view";
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
        // `[[名前|表示]]` は縦棒の前が名前（ADR-0064）。表示の字の上で
        // 押しても同じノートへ行く
        const raw = state.sliceDoc(node.from + 2, node.to - 2);
        const name = raw.split("|")[0].trim();
        return name ? { kind: "note", payload: name } : null;
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

/// その場所を Cmd+クリックしたら何か起きるか（= 指差しに変えてよいか）。
/// **押せないもの（`javascript:` など）は押せそうに見せない** — 判定は
/// クリックと同じ `activationAt` に任せる（参照実装 `_activation_at`）
export function pointerAt(
  state: EditorState,
  pos: number | null,
  held: boolean,
): boolean {
  if (!held || pos === null) return false;
  return activationAt(state, pos) !== null;
}

/// 押せる場所の上に居るとき、編集領域に付ける印。CSS はこれを見て
/// カーソルの形を変える
export const POINTER_CLASS = "cm-activatable";

/// Cmd を押しながらリンクに重ねたら**指差しにする**（参照実装
/// `editor_widget._update_hover` の移植）。
///
/// **形は「重ねた位置」と「Cmd の状態」の両方から決める。** 動かしたときしか
/// 見ないと、**リンクに触れてから Cmd を押した**ときに変わらない（参照実装が
/// 実機報告 2026-08-30 で踏んだ穴）。だから keydown / keyup も合図にする。
///
/// 状態は DOM のクラスだけで持つ（dispatch しない）。打鍵ごとの再計算を
/// 増やさないため、また IME の最中に dispatch しないため（T5）。
const activationCursor = ViewPlugin.fromClass(
  class implements PluginValue {
    /// 最後にマウスが居た場所。領域の外へ出たら忘れる — 忘れないと
    /// `Cmd+Tab` で戻った直後の Cmd 押下が、もう指していない場所で
    /// 形を変える（参照実装のレビュー指摘 2026-08-31）
    private at: { x: number; y: number } | null = null;
    private pointing = false;

    constructor(private view: EditorView) {
      window.addEventListener("keydown", this.onKey, true);
      window.addEventListener("keyup", this.onKey, true);
      // 窓から離れると keyup が来ない（Cmd+Tab）。押していない扱いに戻す
      window.addEventListener("blur", this.onBlur);
    }

    destroy() {
      window.removeEventListener("keydown", this.onKey, true);
      window.removeEventListener("keyup", this.onKey, true);
      window.removeEventListener("blur", this.onBlur);
      this.apply(false);
    }

    move(event: MouseEvent) {
      this.at = { x: event.clientX, y: event.clientY };
      this.refresh(event.metaKey);
    }

    leave() {
      this.at = null;
      this.apply(false);
    }

    private onKey = (event: KeyboardEvent) => this.refresh(event.metaKey);
    private onBlur = () => this.apply(false);

    /// 名前は refresh（`update` は PluginValue の予約席 = ViewUpdate 用）
    private refresh(held: boolean) {
      const pos = this.at
        ? this.view.posAtCoords({ x: this.at.x, y: this.at.y })
        : null;
      this.apply(pointerAt(this.view.state, pos, held));
    }

    private apply(pointing: boolean) {
      if (pointing === this.pointing) return; // 触るのは変わったときだけ
      this.pointing = pointing;
      this.view.dom.classList.toggle(POINTER_CLASS, pointing);
    }
  },
  {
    eventHandlers: {
      mousemove(event: MouseEvent) {
        this.move(event);
      },
      mouseleave() {
        this.leave();
      },
    },
  },
);

/// Cmd+クリックで activation を発火させる。判定が無ければ通常のクリック。
export const activationClicks = [
  activationCursor,
  EditorView.domEventHandlers({
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
  }),
];
