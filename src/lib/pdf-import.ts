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

/// このページには文字が入っている、とみなす字数。これ未満なら
/// 読み取り（OCR）に回す。
///
/// **0 文字では判断しない**（ADR-0027 追記）。紙のページからは罫線や
/// ページ番号の誤認で数文字だけ取れることがあり、そこで「文字がある」と
/// 判断すると読めないまま終わる。
export const OCR_THRESHOLD = 20;

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

/// 文字の無いページだけを読み取りに回し、ページごとの文字を揃える
/// （ADR-0027 追記: 切り分けはページごと）。
///
/// **読めたページは捨てない。** あるページの読み取りが失敗（Ollama が
/// 動いていない等）しても、そのページを空のまま残して先へ進む。何ページ
/// 失敗したかと最初の失敗を返すので、呼び出し側が知らせられる。
export async function fillBlankPages(
  pages: readonly string[],
  count: number,
  read: (page: number) => Promise<string>,
  onProgress?: (page: number, count: number) => void,
): Promise<{ texts: string[]; failed: number; error: unknown }> {
  const texts: string[] = [];
  let failed = 0;
  let error: unknown = null;
  for (let index = 0; index < count; index++) {
    const page = pages[index] ?? "";
    if (page.trim().length >= OCR_THRESHOLD) {
      texts.push(page); // 速くて正確なほうを黙って捨てない
      continue;
    }
    onProgress?.(index + 1, count);
    try {
      const found = await read(index + 1);
      // **読み取りが元より短ければ捨てる**（外すこともあるので、短くても
      // 本物の文字が入っているページを潰さない）
      texts.push(found.trim().length > page.trim().length ? found : page);
    } catch (caught) {
      failed += 1;
      error ??= caught;
      texts.push(page);
    }
  }
  return { texts, failed, error };
}
