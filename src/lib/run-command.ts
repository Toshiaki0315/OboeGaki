// 押した操作を走らせ、失敗したらステータス欄に「何ができなかったか」を出す。
//
// App.tsx の非同期の操作（書き出し・雛形・ゴミ箱・添付の掃除・同期）は
// `void handleX()` で呼んでいて、中に catch が無いものは Rust が断っても
// 無反応に見えた（棚卸し 2026-09-17 / 17-6）。成功の知らせは操作ごとに
// 違うので呼ぶ側が持ち、ここは失敗だけを引き受ける。

/// 失敗をステータスの文にする: 「○○できませんでした: 理由」。App.tsx の catch は
/// 全部この形（以前は「〜に失敗:」と「〜できませんでした:」が混ざっていた。19-4）
export function failureText(label: string, error: unknown): string {
  return `${label}できませんでした: ${String(error)}`;
}

export async function runWithStatus(
  setStatus: (message: string) => void,
  label: string,
  run: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    setStatus(failureText(label, error));
    return false;
  }
}
