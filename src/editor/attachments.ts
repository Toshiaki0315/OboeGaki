// 画像の貼り付け / ドロップ取り込み（TASKS 1-2、参照実装 editor/attachments.py）。
//
// 判定と組み立ては純関数に置き、DOM イベント処理は薄い橋渡しに保つ。
// 「添付として扱うつもり」なら、読めなくても既定動作を止める —
// 素通しすると `file:///...png` という文字列が本文へ落ちる。

import { EditorView } from "@codemirror/view";
import type { EditorState, Extension, Text } from "@codemirror/state";

// 落とされたファイルを画像として扱う拡張子（参照実装 IMAGE_SUFFIXES）
const IMAGE_SUFFIXES = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "heic",
]);

type FileLike = { name?: string; type?: string };

export function isImageFile(file: FileLike): boolean {
  if (file.type?.startsWith("image/")) return true;
  const name = file.name ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_SUFFIXES.has(name.slice(dot + 1).toLowerCase());
}

export function pickImages<T extends FileLike>(files: readonly T[]): T[] {
  return files.filter(isImageFile);
}

export function looksLikeAttachment(files: readonly FileLike[]): boolean {
  return pickImages(files).length > 0;
}

/// 保存できた分の Markdown を改行で繋ぐ（参照実装 _insert_attachments）。
export function markdownFor(links: readonly (string | null)[]): string {
  return links.filter((link): link is string => Boolean(link)).join("\n");
}

/// 添付を保存して本文へ挿す Markdown（`![](attachments/…)`）を返す。
/// 保存できなかったら null（その分は本文に何も入れない）。
export type SaveAttachment = (
  data: Uint8Array,
  name: string,
) => Promise<string | null>;

/// 保存が終わったあとの挿し込み先。保存を待っている間に文書が変わって
/// いたら、捕まえた位置ではなく**今のカーソル位置**へ挿す — 古い位置は
/// 打ち込んだ文字の途中を指し得るし、文書が縮んでいれば範囲外で落ちる
///（レビュー 2026-09-04）。Text は不変なので同一性で「変わったか」が分かる。
export function insertionTarget(
  startDoc: Text,
  captured: { from: number; to: number },
  state: EditorState,
): { from: number; to: number } {
  if (
    state.doc === startDoc &&
    captured.from <= state.doc.length &&
    captured.to <= state.doc.length
  ) {
    return captured;
  }
  const head = state.selection.main.head;
  return { from: head, to: head };
}

async function saveAll(
  save: SaveAttachment,
  files: readonly File[],
): Promise<string> {
  const links = await Promise.all(
    files.map(async (file) => {
      try {
        return await save(new Uint8Array(await file.arrayBuffer()), file.name);
      } catch {
        return null;
      }
    }),
  );
  return markdownFor(links);
}

function insertAt(view: EditorView, from: number, to: number, text: string) {
  if (!text) return;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.paste",
  });
}

/// 貼り付け・ドロップの画像を vault へ取り込む拡張。
export function attachmentEvents(save: SaveAttachment): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!looksLikeAttachment(files)) return false;
      event.preventDefault();
      const startDoc = view.state.doc;
      const captured = {
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      };
      void saveAll(save, pickImages(files)).then((text) => {
        const target = insertionTarget(startDoc, captured, view.state);
        insertAt(view, target.from, target.to, text);
      });
      return true;
    },
    drop: (event, view) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!looksLikeAttachment(files)) return false;
      event.preventDefault();
      // 落とした場所へ挿す。座標が本文の外なら今のカーソル位置
      const startDoc = view.state.doc;
      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head;
      void saveAll(save, pickImages(files)).then((text) => {
        const target = insertionTarget(
          startDoc,
          { from: pos, to: pos },
          view.state,
        );
        insertAt(view, target.from, target.to, text);
      });
      return true;
    },
  });
}
