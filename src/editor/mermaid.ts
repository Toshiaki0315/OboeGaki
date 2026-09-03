// Mermaid 図（TASKS 4-2 / ADR-0021 の Tauri 版）。
//
// 参照実装は隠した QWebEngineView（Chromium）で mermaid.min.js を走らせ、
// SVG を grab して QPixmap にしていた。**その足場はもう要らない** —
// アプリ自体が WebView なので、同じ JS をその場で呼べる。
// ADR-0021 の落とし穴（show() しないと描画されない / GPU で真っ白 /
// 透明背景が白に落ちる）は、前提ごと消えた。
//
// **図を使わない人に読み込みを払わせない。** mermaid は大きいので
// 動的 import にし、図のあるノートを開いて初めて読み込む
// （ADR-0021 の「Chromium は図のあるノートを開いて初めて立ち上げる」と
// 同じ考え方）。
//
// 描画は非同期。出来るまでは生のまま見せ、出来たところで差し替える
// （画像 widget と同じ手口）。

/// 図の見た目はテーマに追従する。**キャッシュの鍵に含める**
/// （含めないと、ダークに切り替えても明るい図が残る）。
export type MermaidTheme = "light" | "dark";

export function cacheKey(theme: MermaidTheme, code: string): string {
  return `${theme}\n${code}`;
}

/// 本文の ```mermaid フェンスの中身を、出てくる順に返す。
///
/// 書き出し（HTML）で使う。**フェンスの言語名だけを見る** — 本文の走査は
/// エディタ側が Lezer で行うので、ここは書き出しのための素朴な走査でよい。
export function collectMermaid(text: string): string[] {
  const found: string[] = [];
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const fence = /^(\s*)(`{3,}|~{3,})\s*mermaid\s*$/.exec(lines[index]);
    if (!fence) {
      index += 1;
      continue;
    }
    const closing = new RegExp(`^\\s*${fence[2][0]}{${fence[2].length},}\\s*$`);
    const body: string[] = [];
    index += 1;
    while (index < lines.length && !closing.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) break; // 閉じが無い。図にしない
    index += 1;
    const code = body.join("\n").trim();
    if (code) found.push(code);
  }
  return found;
}

// 描いた図（鍵は cacheKey）。**同じ図を何度も描かない** — 装飾は打鍵や
// スクロールのたびに組み直される
const cache = new Map<string, Promise<string | null>>();

let loading: Promise<typeof import("mermaid").default> | null = null;

async function library(theme: MermaidTheme) {
  if (!loading) {
    loading = import("mermaid").then((module) => module.default);
  }
  const mermaid = await loading;
  mermaid.initialize({
    startOnLoad: false,
    // 図の中の HTML を信じない（本文は人が書いたものだが、他所から
    // 貼られた図が混ざりうる）
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: 'system-ui, -apple-system, "Hiragino Sans", sans-serif',
  });
  return mermaid;
}

/// 図を SVG にする。**描けなければ null**（生のコードのまま見せる。
/// エラー図を本文に残すと「直せない何か」が出る — 数式と同じ判断）。
export function renderMermaid(
  code: string,
  theme: MermaidTheme,
): Promise<string | null> {
  const key = cacheKey(theme, code);
  const known = cache.get(key);
  if (known) return known;
  const started = draw(code, theme);
  cache.set(key, started);
  return started;
}

async function draw(code: string, theme: MermaidTheme): Promise<string | null> {
  try {
    const mermaid = await library(theme);
    // id は DOM に残る一時要素の名前。図ごとに変える
    const id = `oboegaki-mermaid-${Math.random().toString(36).slice(2)}`;
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch {
    // mermaid は失敗した図の残骸を DOM に残すことがある。後始末して
    // 「描けなかった」を覚える（同じ図を毎回試さない）
    // mermaid は計測用の要素を `d` + id で残すことがある（両方掃除する）
    document
      .querySelectorAll('[id^="oboegaki-mermaid-"], [id^="doboegaki-mermaid-"]')
      .forEach((node) => node.remove());
    return null;
  }
}
