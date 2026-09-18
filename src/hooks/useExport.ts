// 書き出し・印刷・取り込み（HTML / Word / PowerPoint / 印刷と PDF / PDF・PPTX・画像
// の取り込み）。App.tsx にあった約 320 行で、UI とは結合していない最大の塊
// （19-4。2026-09-18）。Tauri は lib/ipc 経由（ADR-0049）。持つ状態は印刷用の本文だけ。
// 文書の真実は EditorView（T2）— ここは保存済みの本文を Rust から読み直して組む

import { useEffect, useState } from "react";
import { useLatest } from "./useLatest";
import { noteStem } from "../lib/note-path";
import { buildDocx } from "../lib/export-docx";
import { ocrFailureText, ocrReaderFrom } from "../lib/ocr";
import {
  collectMermaid,
  renderMermaid,
  type MermaidTheme,
} from "../editor/mermaid";
import {
  codeKey,
  collectCodeBlocks,
  renderBody,
  renderHtml,
} from "../lib/export-html";
import {
  type CodeRun,
  highlightCodeHtml,
  highlightCodeRuns,
} from "../lib/export-code";
import { MERMAID_IMAGE_PREFIX, codeBlocksOf } from "../lib/slides";
import {
  rasterizeIfSvg,
  svgFromDataUrl,
  svgNaturalSize,
  svgToPng,
} from "../lib/svg-png";
import { buildPptx, readTemplateTheme } from "../lib/pptx";
import { readSlideTheme, slideThemeFrom } from "../lib/slide-theme";
import { slideMetrics } from "../lib/slide-grid";
import { overflowingSlides } from "../lib/slide-lint";
import { type PptxSettings } from "../lib/pptx-settings";
import { readPptx, slidesToMarkdown } from "../lib/pptx-import";
import {
  importFilter,
  importTitle,
  toMarkdown,
  type ImportKind,
} from "../lib/imported";
import { fillBlankPages, pdfPages } from "../lib/pdf-import";
import { type Settings } from "../lib/settings";
import {
  createNote,
  ocrImage,
  ocrPdfPage,
  imageSource,
  readNote,
  writeNote,
  exportWrite,
  exportWriteBinary,
  importRead,
  pdfPageCount,
  pickFile,
  printPage,
  saveTo,
} from "../lib/ipc";
import { buildDeck } from "../lib/slide-split";

export type ExportInput = {
  vaultRoot: string | null;
  currentPath: string | null;
  settings: Settings;
  pptxSettings: PptxSettings;
  /// 図の見た目（ADR-0021）。印刷と HTML は画面と同じ、PowerPoint は明るいテーマ
  diagramTheme: MermaidTheme;
  /// 保存前の本文を書き出さないための待ち
  flush: () => Promise<void>;
  /// 埋め込み `![[…]]` の中身（深さ 1）
  resolveEmbeds: (text: string) => Promise<Map<string, string>>;
  onStatus: (text: string) => void;
  /// 取り込んで作ったノートを一覧に載せて開く
  refreshLists: () => Promise<void>;
  openNote: (path: string) => Promise<void>;
};

export function useExport(input: ExportInput) {
  const latest = useLatest(input);
  const onStatus = (text: string) => latest.current.onStatus(text);

  // 印刷用に組んだ本文（ADR-0038）。null なら一度も刷っていない。
  // **同じ本文をもう一度刷れるよう毎回別の値にする**（文字列だけだと
  // 2 回目の `Cmd+P` で state が変わらず、印刷パネルが出ない）
  const [printBody, setPrintBody] = useState<{
    html: string;
    at: number;
  } | null>(null);

  // 組み終わって**画面に出てから**印刷パネルを出す（先に呼ぶと、まだ
  // DOM に無いものが刷られる）
  useEffect(() => {
    if (printBody === null) return;
    const frame = requestAnimationFrame(() => {
      void printPage().catch((error) =>
        latest.current.onStatus(`印刷できませんでした: ${String(error)}`),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [printBody, latest]); // latest は不変の ref（lint が useLatest を ref と知らない）

  // HTML 書き出し（ADR-0007 の CM6 版）。画像は data URL に埋め込んで
  // 1 ファイルで持ち運べる形にする
  /// 図を先に描く（描画は非同期。書き出しにも印刷にも SVG を埋める）。
  async function drawDiagrams(text: string): Promise<Map<string, string>> {
    const { diagramTheme } = latest.current;
    const diagrams = new Map<string, string>();
    for (const code of collectMermaid(text)) {
      const svg = await renderMermaid(code, diagramTheme);
      if (svg) diagrams.set(code, svg);
    }
    return diagrams;
  }

  /// Mermaid を PNG にする（PowerPoint 用。要望 2026-09-08）。**紙の上の図は
  /// 明るいテーマで描く** — アプリがダークでも紙は白地
  async function drawDiagramPngs(text: string): Promise<Map<string, string>> {
    const drawn = new Map<string, string>();
    for (const code of collectMermaid(text)) {
      const svg = await renderMermaid(code, "light");
      const png = svg ? await svgToPng(svg) : null;
      if (png) drawn.set(code, png);
    }
    return drawn;
  }

  /// コードを先に色分けする（パーサの読み込みが非同期。TASKS 4-4）。
  async function colorCode(text: string): Promise<Map<string, string>> {
    const colored = new Map<string, string>();
    for (const block of collectCodeBlocks(text)) {
      const html = await highlightCodeHtml(block.code, block.info);
      if (html) colored.set(codeKey(block.info, block.code), html);
    }
    return colored;
  }

  /// 画像を data URL にして埋める（**外部リソースを参照しない** = ADR-0007）。
  async function embedImages(html: string, root: string): Promise<string> {
    const tag = /<img src="([^"]+)"([^>]*)>/g;
    const sources = new Set([...html.matchAll(tag)].map((found) => found[1]));
    const resolved = new Map<string, string>();
    for (const src of sources) {
      const data = await imageSource(root, src);
      if (data) resolved.set(src, data);
    }
    return html.replace(tag, (whole, src: string, rest: string) => {
      const data = resolved.get(src);
      if (!data) return whole;
      // 幅の無い SVG は viewBox の大きさを書く（本文の絵と同じ理由。
      // 書き手が `|300` と書いた幅があればそちらを残す）
      const svg = svgFromDataUrl(data);
      const natural = svg === null ? null : svgNaturalSize(svg);
      const size =
        natural && !/\swidth="/.test(rest)
          ? ` width="${natural.width}" height="${natural.height}"`
          : "";
      return `<img src="${data}"${rest}${size}>`;
    });
  }

  /// 印刷（ADR-0038）。**書き出しと同じ本文**を隠しの領域に組み、
  /// `@media print` でそこだけを紙に出す。エディタ（CM6）は見えている
  /// 範囲しか DOM に無いので、そのまま刷ると本文が欠ける。
  async function handlePrint(forPdf = false) {
    const { vaultRoot, currentPath } = latest.current;
    if (!vaultRoot || !currentPath) return;
    // **PDF はここから先が OS の仕事。** 印刷の窓のどこを押せばよいかを
    // 先に言っておく（差分の調べ 2026-09-06: できるのに気づかれない）
    if (forPdf) {
      onStatus("印刷の窓の左下［PDF］から「PDF として保存」を選べます");
    }
    await latest.current.flush(); // 保存前の本文を刷らない
    const text = await readNote(vaultRoot, currentPath);
    const body = renderBody(
      text,
      await drawDiagrams(text),
      await colorCode(text),
      await latest.current.resolveEmbeds(text),
    );
    setPrintBody({ html: await embedImages(body, vaultRoot), at: Date.now() });
  }

  /// PowerPoint に書き出す（TASKS 4-5 / F-5）。
  /// **ざっくり作って手で整える**前提。割り方は lib/slides.ts が決める。
  /// Word に書き出す（ADR-0059 / 12-8）。HTML と同じ解析から組む。数式は
  /// 元の LaTeX、Mermaid は PNG（PowerPoint と同じ経路）、埋め込みは展開
  async function handleExportDocx() {
    const { vaultRoot, currentPath, settings } = latest.current;
    if (!vaultRoot || !currentPath) return;
    await latest.current.flush(); // 保存前の本文を書き出さない
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    const target = await saveTo({
      defaultPath: `${title}.docx`,
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (!target) return;
    onStatus("Word を組んでいます…");
    try {
      const data = await buildDocx(text, {
        title,
        resolveImage: (url) => imageSource(vaultRoot, url).then(rasterizeIfSvg),
        diagrams: await drawDiagramPngs(text),
        embeds: await latest.current.resolveEmbeds(text),
        bodyFont: settings.bodyFont,
        monoFont: settings.monoFont,
      });
      await exportWriteBinary(target, data);
      onStatus(`書き出しました: ${target}`);
    } catch (error) {
      onStatus(`Word の書き出しに失敗: ${String(error)}`);
    }
  }

  async function handleExportPptx() {
    const { vaultRoot, currentPath, pptxSettings } = latest.current;
    if (!vaultRoot || !currentPath) return;
    await latest.current.flush(); // 保存前の本文を書き出さない
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    const target = await saveTo({
      defaultPath: `${title}.pptx`,
      filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
    });
    if (!target) return;
    onStatus("PowerPoint を組んでいます…");
    try {
      // 土台は環境設定（8-1）、**ノートの front matter が勝つ**
      //（SC-02 > SC-01。ADR-0046 の決定 4）
      const metrics = slideMetrics(pptxSettings);
      // 収まらないぶんは次の枚へ送る（CFG-46）。**測ってから割る**ので、
      // 見張り（下）は割ったあとの姿を見ることになる
      // Mermaid は図（画像）として置く。描けなかった図はコードのまま
      const diagrams = await drawDiagramPngs(text);
      const deck = buildDeck(text, pptxSettings, metrics, (source) =>
        diagrams.has(source),
      );
      // 書き出し前チェック（CFG-70）。**測り方は近似**なので、止めるのは
      // 「厳格」を選んだときだけ。ふだんは知らせて先へ進む
      const over =
        pptxSettings.advanced.lintLevel === "off"
          ? []
          : overflowingSlides(deck, metrics);
      if (over.length > 0 && pptxSettings.advanced.lintLevel === "strict") {
        onStatus(
          `${over.length} 枚で文字が収まらないかもしれません（${over
            .map((slide) => slide.title)
            .join("・")}）。書き出しを止めました`,
        );
        return;
      }
      // コードは字句ごとに色を付ける（12-12。HTML と同じ切り方）。解析は
      // 非同期なので先に済ませて渡す
      const codeRuns = new Map<string, CodeRun[]>();
      for (const block of codeBlocksOf(deck)) {
        if (!block.language) continue;
        const runs = await highlightCodeRuns(block.text, block.language);
        if (runs) codeRuns.set(codeKey(block.language, block.text), runs);
      }
      const data = await buildPptx(
        deck,
        (url) =>
          url.startsWith(MERMAID_IMAGE_PREFIX)
            ? Promise.resolve(
                diagrams.get(url.slice(MERMAID_IMAGE_PREFIX.length)) ?? null,
              )
            : imageSource(vaultRoot, url).then(rasterizeIfSvg),
        readSlideTheme(text, slideThemeFrom(pptxSettings)),
        await borrowedTheme(),
        {
          footer: pptxSettings.footer,
          decoration: pptxSettings.decoration,
          metrics,
          codeRuns,
        },
      );
      await exportWriteBinary(target, data);
      onStatus(
        over.length > 0
          ? `書き出しました: ${target}（${over.length} 枚で文字が収まらないかもしれません）`
          : `書き出しました: ${target}`,
      );
    } catch (error) {
      onStatus(`書き出せませんでした: ${String(error)}`);
    }
  }

  /// PDF のページを読む。**文字が取れないページだけ**読み取りに回す
  /// （ADR-0027 追記: 切り分けはページごと）。
  ///
  /// **ページ数は Rust にも訊く。** 文字の層が無い PDF（macOS の
  /// 「印刷 → PDF」や取り込んだ紙）では pdf.js が 1 ページも返さないことが
  /// あり、そのときページの並びが空だと**読み取りに一度も回らないまま
  /// 「文字を取り出せませんでした」で終わる**（実機報告 2026-09-05）。
  /// PDF のページの文字。文字の無いページだけ読み取りに回す（ADR-0027 追記）。
  /// 読み取りに失敗したページは空のまま残し、**読めたページは捨てない**。
  /// 失敗があれば知らせの文を返す
  async function readPdfPages(bytes: Uint8Array, data: string) {
    const pages = await pdfPages(bytes);
    const count = pages.length || (await pdfPageCount(data));
    const reader = ocrReaderFrom(latest.current.settings);
    // **絵にするのも Rust の仕事**（同じ機械の中で完結させる）
    const found = await fillBlankPages(
      pages,
      count,
      (page) => ocrPdfPage(data, page, reader),
      (page, total) =>
        onStatus(`文字を読み取っています… ${page}/${total} ページ`),
    );
    const trouble =
      found.failed > 0
        ? `${found.failed} ページを読み取れませんでした — ${
            ocrFailureText(found.error) ?? String(found.error)
          }`
        : null;
    return { texts: found.texts, trouble };
  }

  /// PowerPoint を読み込んでノートにする（TASKS 4-5 / F-3）。
  /// **ざっくり読んで手で直す**前提。中身だけが残り、見た目は戻らない。
  /// 読み込む（メニューの「インポート」→ 形式）。**形式を決めてから探す**
  /// ので、窓には関係ないファイルが並ばない（要望 2026-09-13）。
  /// 読み方の振り分けは今までどおり拡張子で行う
  async function handleImport(kind: ImportKind) {
    const { vaultRoot } = latest.current;
    if (!vaultRoot) return;
    const picked = await pickFile({ filters: [importFilter(kind)] });
    if (typeof picked !== "string") return;
    onStatus("読み込んでいます…");
    try {
      const data = await importRead(picked);
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const name = picked.split("/").pop() ?? "資料";
      const title = importTitle(name);
      // 形式ごとに読み方は違うが、**整えるのは同じ**（lib/imported.ts）
      let markdown: string;
      let trouble: string | null = null; // 読み取れなかったページの知らせ
      if (/\.(png|jpe?g|heic|tiff?)$/i.test(name)) {
        markdown = toMarkdown(
          [await ocrImage(data, ocrReaderFrom(latest.current.settings))],
          title,
        );
      } else if (/\.pdf$/i.test(name)) {
        const read = await readPdfPages(bytes, data);
        markdown = toMarkdown(read.texts, title);
        trouble = read.trouble;
      } else {
        markdown = slidesToMarkdown(title, await readPptx(bytes));
      }
      if (!markdown) {
        // 中身が無ければ題名だけのノートを作らせない
        onStatus("文字を取り出せませんでした");
        return;
      }
      const path = await createNote(vaultRoot, title);
      await writeNote(
        vaultRoot,
        path,
        markdown,
        latest.current.settings.historyMinutes,
      );
      await latest.current.refreshLists();
      await latest.current.openNote(path);
      onStatus(
        trouble ?? "読み込みました（見た目は戻りません。手で整えてください）",
      );
    } catch (error) {
      // 読み取りの失敗は人の言葉で（ADR-0027 決定 4）。それ以外はそのまま
      onStatus(
        ocrFailureText(error) ?? `読み込めませんでした: ${String(error)}`,
      );
    }
  }

  async function handleExport() {
    const { vaultRoot, currentPath } = latest.current;
    if (!vaultRoot || !currentPath) return;
    await latest.current.flush(); // 保存前の本文を書き出さない
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    const html = await embedImages(
      renderHtml(
        text,
        title,
        await drawDiagrams(text),
        await colorCode(text),
        await latest.current.resolveEmbeds(text),
      ),
      vaultRoot,
    );
    const target = await saveTo({
      defaultPath: `${title}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!target) return;
    await exportWrite(target, html);
    onStatus(`書き出しました: ${target}`);
  }

  /// テンプレートから借りる配色と書体（TASKS 5-6）。**読めなければ null** —
  /// テンプレートが壊れていても書き出しは止めない。
  async function borrowedTheme() {
    const path = latest.current.settings.slideTemplate;
    if (!path) return null;
    try {
      const base64 = await importRead(path);
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const parts = await readTemplateTheme(bytes);
      if (!parts)
        onStatus("テンプレートを読めませんでした（既定の見た目で出します）");
      return parts;
    } catch {
      onStatus("テンプレートを開けませんでした（既定の見た目で出します）");
      return null;
    }
  }

  /// 前のノートの印刷用の組みを捨てる（ノートを開き直したとき。ADR-0038）
  const discardPrintBody = () => setPrintBody(null);

  return {
    printBody,
    discardPrintBody,
    handlePrint,
    handleExport,
    handleExportDocx,
    handleExportPptx,
    handleImport,
  };
}
