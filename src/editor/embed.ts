// 埋め込み `![[ノート名]]`（ADR-0058 / 12-7）の描き方。
//
// 行まるごとが埋め込みのときだけ、別のノートの中身を**読み専用の入れ子の
// ビュー**で描く（文書は 1 文字も変えない = T1。参照ペインと同じ描き方）。
// 名前の解決・開く・変更の見張りは App が facet で渡す。入れ子の中の埋め込み
// は解決しない（深さ 1 — 循環と重さを避ける）。

import { EditorState, Facet, type Extension } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { sectionOf, splitEmbedTarget } from "../lib/section";

export type EmbedSource = { path: string; text: string };

export type EmbedResolver = {
  /// 名前（`#見出し` を除いたもの）からノートを引く。無ければ null
  resolve: (name: string) => Promise<EmbedSource | null>;
  /// 見出しを押した: そのノートを主窓で開く
  open: (path: string) => void;
  /// そのノートが変わったら知らせる。返り値で見張りをやめる
  watch?: (path: string, onChange: () => void) => () => void;
};

export const NO_EMBED: EmbedResolver = {
  resolve: async () => null,
  open: () => {},
};

export const embedResolver = Facet.define<EmbedResolver, EmbedResolver>({
  combine: (values) => values[0] ?? NO_EMBED,
});

/// 入れ子のビューに入れる拡張（Markdown の解析と見た目）。Editor が組む —
/// ここから live-preview を読むと import が循環する
export const embedExtensions = Facet.define<() => Extension, () => Extension>({
  combine: (values) => values[0] ?? (() => []),
});

type Mounted = { view: EditorView | null; unwatch: (() => void) | null };
const mounted = new WeakMap<HTMLElement, Mounted>();

export class EmbedWidget extends WidgetType {
  /// `名前#見出し` の字面（テストと eq の鍵）
  constructor(readonly embedName: string) {
    super();
  }
  eq(other: EmbedWidget): boolean {
    return other.embedName === this.embedName;
  }
  toDOM(view: EditorView): HTMLElement {
    const holder = document.createElement("div");
    holder.className = "cm-embed";
    const head = document.createElement("div");
    head.className = "cm-embed-head";
    const body = document.createElement("div");
    body.className = "cm-embed-body";
    body.textContent = "読み込み中…";
    holder.append(head, body);
    const { name, heading } = splitEmbedTarget(this.embedName);
    head.textContent = heading ? `${name} › ${heading}` : name;
    const state: Mounted = { view: null, unwatch: null };
    mounted.set(holder, state);
    const resolver = view.state.facet(embedResolver);
    const render = async () => {
      const found = await resolver.resolve(name);
      state.view?.destroy();
      state.view = null;
      if (!found) {
        body.textContent = `「${name}」というノートはありません`;
        view.requestMeasure();
        return;
      }
      const text = heading ? sectionOf(found.text, heading) : found.text;
      if (text === null) {
        body.textContent = `「${name}」に「${heading}」という見出しはありません`;
        view.requestMeasure();
        return;
      }
      body.textContent = "";
      head.classList.add("is-link");
      head.title = "押すとこのノートを開く";
      head.onclick = () => resolver.open(found.path);
      state.view = new EditorView({
        state: EditorState.create({
          doc: text,
          extensions: [
            view.state.facet(embedExtensions)(),
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
          ],
        }),
        parent: body,
      });
      if (!state.unwatch && resolver.watch) {
        state.unwatch = resolver.watch(found.path, () => void render());
      }
      view.requestMeasure();
    };
    void render();
    return holder;
  }
  destroy(dom: HTMLElement): void {
    const state = mounted.get(dom);
    state?.view?.destroy();
    state?.unwatch?.();
    mounted.delete(dom);
  }
  ignoreEvent(): boolean {
    return true; // 中の操作（スクロール・押す）は外のエディタに渡さない
  }
}
