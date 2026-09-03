// PDF から文字を取り出す（TASKS 4-6 / F-2）。
//
// 参照実装は PySide6 同梱の QtPdf を使っていた（依存が増えないのが決め手）。
// こちらは WebView なので pdf.js（Apache-2.0）をそのまま呼べる。
//
// **読めないことは壊れることではない。** 中身が PDF でなくても、暗号化されて
// いても、空を返して呼び出し側に知らせる。取り込みに失敗してアプリが落ちる
// のがいちばん困る。
//
// pdf.js は大きいので動的 import にする（図 = ADR-0037 と同じ）。

/// ページごとの文字。読めなければ空。
///
/// 位置は取れない（組版された順で返る）ので、段落や箇条書きの区別は
/// 文字の並びから推し量るしかない（lib/imported.ts の仕事）。
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  try {
    const pdfjs = await import("pdfjs-dist");
    // ワーカーは同じ束から取る（外へ取りに行かない = 手元だけで完結する）
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ data: bytes });
    const document = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(joinItems(content.items));
    }
    await task.destroy(); // ワーカーごと片づける
    return pages;
  } catch (error) {
    console.warn("PDF を読めなかった", error);
    return [];
  }
}

type TextItem = { str?: string; hasEOL?: boolean };

/// pdf.js の文字の切れ端を行に組み直す。
///
/// **`hasEOL` が行の終わり。** これを見ずに繋ぐと 1 ページが 1 行になり、
/// 「行が短いこと」で段落を見分ける手掛かり（lib/imported.ts）が消える。
function joinItems(items: unknown[]): string {
  let text = "";
  for (const item of items as TextItem[]) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text;
}
