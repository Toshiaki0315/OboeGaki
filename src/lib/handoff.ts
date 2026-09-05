/// 選んだ文字を外のサービスへ渡す（要望 2026-09-05）。
///
/// **このアプリで初めて、ノートの中身が外へ出る道。** 内蔵のアシスタント
/// （ADR-0025）は同じ機械の中で完結するが、こちらは違う。だから:
///
/// - 押したときだけ動く（自動では渡さない）
/// - 渡すのは**選んだところだけ**（ノート全体を送らない）
/// - 呼び名に「渡す」と書く（外へ出ることが名前で分かる）
/// - 生成 AI へ渡す前に確認する（環境設定で切れる）

export type Handoff = {
  id: "claude" | "gemini" | "chatgpt" | "copilot" | "google";
  /// 相手の名前（確認の窓とサブメニューに出す）
  name: string;
  /// 平らに並べるときの呼び名（何をするかまで書く）
  label: string;
  /// 開くアプリの名前。**決め打ち**（Rust 側も同じ並びで確かめる）
  app?: string;
  /// 検索など、URL で開くもの
  search?: true;
  /// 文字ごと渡せる URL の頭。**アプリが受け取れると分かったものだけ**
  /// （Claude の中に `claude://claude.ai/new?q=…` を読む口がある。
  /// 2026-09-05 に実物で確認）
  deepLink?: string;
};

/// 渡し先。生成 AI を並べ、そのあとに検索を置く。
export const HANDOFFS: readonly Handoff[] = [
  {
    id: "claude",
    name: "Claude",
    label: "Claude に渡す",
    app: "Claude",
    deepLink: "claude://claude.ai/new?q=",
  },
  { id: "gemini", name: "Gemini", label: "Gemini に渡す", app: "Gemini" },
  { id: "chatgpt", name: "ChatGPT", label: "ChatGPT に渡す", app: "ChatGPT" },
  { id: "copilot", name: "Copilot", label: "Copilot に渡す", app: "Copilot" },
  { id: "google", name: "Google", label: "Google で検索", search: true },
];

/// 生成 AI（メニューでは「生成AIに渡す」の下にまとめる。要望 2026-09-05）。
/// **1 つずつ並べると、外へ出る道がメニューの半分を占める。**
export const AI_HANDOFFS = HANDOFFS.filter((entry) => entry.app !== undefined);

/// 検索（生成 AI とは別の扱い。確認も要らない）。
export const SEARCH_HANDOFF = HANDOFFS.find((entry) => entry.search)!;

/// 渡す前に確認するか。**設定は生成 AI 向け**（検索は探す言葉を打つのと
/// 同じ操作なので、毎回聞くと邪魔になる）。
export function needsConfirm(handoff: Handoff, confirmAi: boolean): boolean {
  return confirmAi && handoff.app !== undefined;
}

/// URL に載せられる長さの上限。**日本語は 1 文字が 9 文字に膨らむ**
/// （`%E3%81%82`）ので、字数ではなく組んだ URL の長さで見る。
/// 載せきれないぶんはクリップボード経由に倒す。
const MAX_URL = 16000;

/// 文字ごと渡せる URL。渡せないアプリ・長すぎる文字は null。
export function handoffUrl(handoff: Handoff, text: string): string | null {
  if (!handoff.deepLink) return null;
  const url = handoff.deepLink + encodeURIComponent(text);
  return url.length <= MAX_URL ? url : null;
}

/// Google で探す URL。
export function searchUrl(text: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/// 確認の窓に出す文。**どこへ何が出るかを書く。**
export function confirmMessage(handoff: Handoff, text: string): string {
  const head = [...text.trim()].slice(0, 120).join("");
  const shown = [...text.trim()].length > 120 ? `${head}…` : head;
  return (
    `選んだ文字を ${handoff.name} に渡します。\n` +
    `この内容はこのパソコンの外へ出ます。\n\n${shown}`
  );
}

/// 辞書で引ける長さの上限。**語を引く道具**なので、文を渡さない。
const DICT_MAX = 40;

/// 選んだ語を macOS の辞書で引く URL（TASKS 7-2。ポメラの電子辞書相当）。
///
/// **外へ出ない**（手元の辞書アプリが開くだけ）ので、生成 AI に渡すときの
/// ような確認の窓は挟まない。引けないときは null。
export function dictUrl(text: string): string | null {
  const word = text.trim();
  if (!word || [...word].length > DICT_MAX) return null;
  return `dict://${encodeURIComponent(word)}`;
}
