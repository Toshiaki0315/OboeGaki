// Cmd+クリックの判定と配線（ADR-0010/0011）。参照実装 core/activation.py の移植。
//
// 素のクリックはキャレットの移動が最優先（ADR-0010）。タグもリンクも
// Cmd+クリックに統一する。判定は EditorState だけで動く純関数に置き、
// 何を起こすか（開く・絞り込む）はアプリ側が Facet で注入する。

import {
  EditorView,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { Facet, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { NotePeek } from "./note-peek";

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

/// 余白は「その行の字の上」ではない（実機報告 2026-09-13）。
///
/// `posAtCoords` は**一番近い位置に丸める**ので、リンクのある行の右の余白に
/// 重ねただけでも行末の位置が返り、リンクを指したことになってしまう。
/// その行（折り返した先も含む）の字がどこで終わり・どこから始まるかを引いて、
/// その外なら「字の上には居ない」とみなす。
///
/// **丸めた結果を疑うのであって、当たり判定を作り直すのではない** — 字の上の
/// 判定は今までどおり `posAtCoords` に任せる（半角と全角で幅が違うため、
/// 自前で「何 px 以内」と決めると必ずどちらかで外す）。
function onText(view: EditorView, point: { x: number; y: number }): boolean {
  const far = 10_000;
  // その行の字の終わり・始まり（同じ y で左右の端まで振り切って引く）
  const end = view.posAtCoords({ x: point.x + far, y: point.y }, false);
  const start = view.posAtCoords({ x: point.x - far, y: point.y }, false);
  const right = view.coordsAtPos(end);
  const left = view.coordsAtPos(start);
  if (!right || !left) return true; // 引けないときは邪魔をしない
  return point.x <= right.right && point.x >= left.left;
}

/// その画面座標で押せるもの。**余白は除く**。
///
/// **押せないもの（`javascript:` など）は押せそうに見せない** — 指差しに
/// するかどうかも、飛ぶかどうかも、クリックと同じ `activationAt` に任せる
/// （参照実装 `_activation_at` と同じ構え）。
///
/// 高い方の検査（`onText`）は**当たったときだけ**通す — マウスは動くたびに
/// ここへ来るので、地の文の上で毎回 3 回も座標を引き直さない
function activationHere(
  view: EditorView,
  point: { x: number; y: number },
): Activation | null {
  const pos = view.posAtCoords(point);
  if (pos === null) return null;
  const found = activationAt(view.state, pos);
  return found && onText(view, point) ? found : null;
}

/// 押せる場所の上に居るとき、編集領域に付ける印。CSS はこれを見て
/// カーソルの形を変える
export const POINTER_CLASS = "cm-activatable";

/// Cmd を押しながらリンクに重ねたら**指差しにし、冒頭を泡で出す**
/// （参照実装 `editor_widget._update_hover` の移植）。
///
/// **形と泡は同じ合図から動かす。** 泡をマウスの移動からしか呼ばないと、
/// 「リンクに触れてから Cmd を押す」で形だけ変わって泡が出ない — 押せると
/// 見せたなら、見せられるべき（参照実装の実機報告 2026-08-30）。
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
    private peek: NotePeek;

    constructor(private view: EditorView) {
      this.peek = new NotePeek(view);
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
      this.peek.destroy();
    }

    /// 文書が変わる・巻き取られると位置が古くなる。隠すだけ（次に触れれば
    /// 出直す。写しの印と同じ作法）
    update(change: ViewUpdate) {
      if (change.docChanged || change.geometryChanged) this.peek.hide();
    }

    move(event: MouseEvent) {
      this.at = { x: event.clientX, y: event.clientY };
      this.refresh(event.metaKey);
    }

    leave() {
      // 位置を忘れないと、`Cmd+Tab` で戻った直後の Cmd 押下が、もう指して
      // いない場所で形を変える（参照実装のレビュー指摘 2026-08-31）
      this.at = null;
      this.apply(false);
      this.peek.hide();
    }

    private onKey = (event: KeyboardEvent) => this.refresh(event.metaKey);
    private onBlur = () => {
      this.apply(false);
      this.peek.hide();
    };

    /// 名前は refresh（`update` は PluginValue の予約席 = ViewUpdate 用）
    private refresh(held: boolean) {
      const found = held && this.at ? activationHere(this.view, this.at) : null;
      this.apply(found !== null);
      // 泡を出すのは**ノートへのリンクだけ**（タグや URL は覗く中身が無い）
      this.peek.update(found?.kind === "note" ? found.payload : null, this.at);
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
      // 指差しに変えた場所でだけ飛ぶ（見た目と動きを同じ判定から出す）
      const found = activationHere(view, {
        x: event.clientX,
        y: event.clientY,
      });
      if (!found) return false;
      event.preventDefault();
      view.state.facet(activationHandler)(found);
      return true; // キャレットは動かさない
    },
  }),
];
