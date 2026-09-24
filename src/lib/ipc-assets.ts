// 画像・添付・書き出し・取り込み・印刷・OCR（本文の外にあるファイルのやり取り）。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";
import type { OcrReader } from "./ocr";

/// どのノートからも指されていない添付（E-5）。
export async function unusedAttachments(root: string): Promise<string[]> {
  return invoke<string[]>("attachments_unused", { root });
}

/// 添付をゴミ箱へ移す。移した数が返る。
export async function trashAttachments(
  root: string,
  paths: string[],
): Promise<number> {
  return invoke<number>("attachments_trash", { root, paths });
}

/// 貼り付け・ドロップの画像を attachments/ へ保存し、本文へ挿す
/// Markdown（`![](attachments/…)`）を返す。
export async function saveAttachment(
  root: string,
  data: Uint8Array,
  name: string,
): Promise<string> {
  // Tauri の JSON 経路で運ぶため base64 にする（チャンクで組んで
  // スタック溢れを避ける — spread で一気に渡すと大きい画像で落ちる）
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    binary += String.fromCharCode(...data.subarray(i, i + step));
  }
  return invoke<string>("attachment_save", {
    root,
    data: btoa(binary),
    suffix: name,
  });
}

// 画像の data URL キャッシュ。装飾は再計算のたびに widget を作り直すので、
// invoke の往復を毎回払わない（参照実装 image_cache の役目）
const imageCache = new Map<string, Promise<string | null>>();

export function imageSource(root: string, url: string): Promise<string | null> {
  if (/^(https?:|data:)/i.test(url)) return Promise.resolve(null); // 遠隔は描かない
  let cleaned: string;
  try {
    cleaned = decodeURIComponent(url.replace(/^file:\/\//, ""));
  } catch {
    // `a%zz.png` のような壊れた参照。同期で投げると書き出しごと止まる（21-3）
    return Promise.resolve(null);
  }
  const key = `${root}\n${cleaned}`;
  let entry = imageCache.get(key);
  if (!entry) {
    entry = invoke<string>("image_read", { root, path: cleaned }).catch(() => {
      // 失敗は覚えない。参照切れの画像を後から置いても再起動まで描かれない
      // （棚卸し 2026-09-17）
      imageCache.delete(key);
      return null;
    });
    imageCache.set(key, entry);
  }
  return entry;
}

// ---- 文字の読み取り（OCR）。読み手（ADR-0027 決定 1）は環境設定から。

/// 画像（base64）から文字を読む。読めなければ空、Ollama が無ければ Err
export function ocrImage(data: string, reader: OcrReader): Promise<string> {
  return invoke<string>("ocr_image", { data, reader });
}

/// PDF（base64）のページ（1 始まり）を絵にして文字を読む
export function ocrPdfPage(
  data: string,
  page: number,
  reader: OcrReader,
): Promise<string> {
  return invoke<string>("ocr_pdf_page", { data, page, reader });
}

// ---- 書き出し・取り込み・OS の窓（19-4）。App.tsx が直接呼んでいた 17 か所を
//      ここに寄せた（ADR-0049: 画面側は Tauri を知らない。hooks に切り出すとき
//      「hook が Tauri を直接呼ぶ」にならないための前提）

/// 書き出したファイルを置く（文字）
export function exportWrite(path: string, text: string): Promise<void> {
  return invoke("export_write", { path, text });
}

/// 書き出したファイルを置く（base64 の中身。Word / PowerPoint）
export function exportWriteBinary(path: string, data: string): Promise<void> {
  return invoke("export_write_binary", { path, data });
}

/// 取り込むファイルを読む（base64。上限は Rust 側）
export function importRead(path: string): Promise<string> {
  return invoke<string>("import_read", { path });
}

/// PDF のページ数（pdf.js が 1 ページも返さない PDF の保険。ADR-0027 追記）
export function pdfPageCount(data: string): Promise<number> {
  return invoke<number>("pdf_page_count", { data });
}

/// 印刷パネルを出す（ADR-0038）
export function printPage(): Promise<void> {
  return invoke("print_page", {});
}
