// リンク先をその場で覗く（U-2。参照実装 editor/link_preview.py の移植）。
//
// `[[ノート]]` に `Cmd` を押しながら触れると、**開かずに**冒頭が浮いて出る。
// 確かめるために開いて戻る往復が要らなくなる。
//
// **`Cmd` を要る条件にする。** 素の移動で泡が出ると、文字を選ぼうとしただけで
// 邪魔になる — カーソルの形（activation.ts）が同じ理由で `Cmd` を条件に
// しており、開く操作自体も `Cmd+クリック` なので揃う。
//
// ここは **vault を知らない**。題名から中身を引く係は呼ぶ側が挿す
// （埋め込みと同じ `embedResolver` を使う）。

import type { EditorView } from "@codemirror/view";
import { embedResolver } from "./embed";
import { frontMatterRange } from "./frontmatter";

/// 触れてから出すまでの待ち。**短すぎると通り過ぎるだけで出る。**
/// ツールチップの標準（500ms 前後）より気持ち早める — こちらは `Cmd` を
/// 押している時点で「見たい」意思が入っている
export const PEEK_DELAY_MS = 400;

/// 覗かせる行数。**全部は出さない**（それは開くこと）
export const PEEK_LINES = 6;

/// 行が長いときの上限。泡が画面を覆わないように
export const PEEK_CHARS = 240;

/// 本文の冒頭。**題名の行は落とす**（泡の見出しと重なる）。
///
/// 記号は落とさない — `- ` や `` ` `` が消えると、箇条書きなのかコードなのか
/// 分からなくなる。読めれば十分なので、行数と字数だけで切る。
export function peekExcerpt(text: string): string {
  // **front matter は出さない。** 実物のノートには作成日時と id が付いて
  // おり、そのまま出すと泡が YAML で埋まる
  const body = text.slice(frontMatterRange(text)?.bodyStart ?? 0);
  const lines: string[] = [];
  // 落とすのは**最初の 1 行だけ**。門を開けたままにすると、先頭に見出しが
  // 続くノートで `## 節` まで捨ててしまい、骨組みだけのノートが空 =
  // 「まだ無いノート」に見える（参照実装のレビュー指摘 2026-08-31）
  let skippedTitle = false;
  for (const line of body.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    if (lines.length === 0 && !skippedTitle && stripped.startsWith("#")) {
      skippedTitle = true;
      continue; // 題名の行
    }
    lines.push(line.trimEnd());
    if (lines.length >= PEEK_LINES) break;
  }
  const found = lines.join("\n");
  return found.length <= PEEK_CHARS ? found : `${found.slice(0, PEEK_CHARS)}…`;
}

/// 泡そのもの（出す・隠す・待つ）。**位置と Cmd の状態は持たない** —
/// それは activation.ts の見張りが持っていて、ここへ渡してくる
export class NotePeek {
  private bubble: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /// いま出している（または出そうとしている）題名。同じリンクの上で
  /// 出し直さないための印
  private showing: string | null = null;
  /// 取り寄せの世代。遅れて届いた中身で、もう違う場所の泡を出さない
  private generation = 0;

  constructor(private view: EditorView) {}

  /// 今の位置と `Cmd` の状態から、出す用意をする。
  /// name が null（リンクの外・Cmd を押していない）なら隠す
  update(name: string | null, at: { x: number; y: number } | null): void {
    if (name === null || at === null) {
      this.hide();
      return;
    }
    if (name === this.showing) return; // 同じリンクの上。出し直さない
    this.hide();
    this.showing = name;
    const token = ++this.generation;
    this.timer = setTimeout(
      () => void this.show(name, at, token),
      PEEK_DELAY_MS,
    );
  }

  hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.showing = null;
    this.generation += 1; // 取り寄せ中のものを無効にする
    this.bubble?.remove();
    this.bubble = null;
  }

  destroy(): void {
    this.hide();
  }

  /// 待ちを終えて出す。**中身が無ければ出さない**（まだ無いノートに
  /// 空の泡を出さない）
  private async show(
    name: string,
    at: { x: number; y: number },
    token: number,
  ): Promise<void> {
    const source = await this.view.state.facet(embedResolver).resolve(name);
    if (token !== this.generation) return; // もう別の場所を見ている
    const body = source ? peekExcerpt(source.text) : "";
    if (!body) return;
    const bubble = document.createElement("div");
    bubble.className = "cm-note-peek";
    const title = bubble.appendChild(document.createElement("div"));
    title.className = "cm-note-peek-title";
    title.textContent = name;
    const excerpt = bubble.appendChild(document.createElement("div"));
    excerpt.className = "cm-note-peek-body";
    excerpt.textContent = body;
    // 画面の外へはみ出さない（右と下は窓の内側に収める）
    bubble.style.left = `${Math.min(at.x + 12, window.innerWidth - 360)}px`;
    bubble.style.top = `${Math.min(at.y + 18, window.innerHeight - 200)}px`;
    // **編集領域の中に入れる**（`document.body` ではなく）。テーマの CSS は
    // `.cm-editor` の下に付くので、外に出すと素の見た目になる
    this.view.dom.appendChild(bubble);
    this.bubble = bubble;
  }
}
