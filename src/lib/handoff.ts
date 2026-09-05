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
  label: string;
  /// 開くアプリの名前。**決め打ち**（Rust 側も同じ並びで確かめる）
  app?: string;
  /// 検索など、URL で開くもの
  search?: true;
};

/// 渡し先。生成 AI を並べ、そのあとに検索を置く。
export const HANDOFFS: readonly Handoff[] = [
  { id: "claude", label: "Claude に渡す", app: "Claude" },
  { id: "gemini", label: "Gemini に渡す", app: "Gemini" },
  { id: "chatgpt", label: "ChatGPT に渡す", app: "ChatGPT" },
  { id: "copilot", label: "Copilot に渡す", app: "Copilot" },
  { id: "google", label: "Google で検索", search: true },
];

/// 渡す前に確認するか。**設定は生成 AI 向け**（検索は探す言葉を打つのと
/// 同じ操作なので、毎回聞くと邪魔になる）。
export function needsConfirm(handoff: Handoff, confirmAi: boolean): boolean {
  return confirmAi && handoff.app !== undefined;
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
    `選んだ文字を ${handoff.label.replace(/ に渡す$/, "")} に渡します。\n` +
    `この内容はこのパソコンの外へ出ます。\n\n${shown}`
  );
}
