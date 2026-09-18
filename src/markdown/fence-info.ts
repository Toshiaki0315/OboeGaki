// コードフェンスの情報文字列 ` ```python:aaa.py ` の分け方（ADR-0008）。
// 言語の解決（CM6 の language-data）は editor/code-blocks.ts に残し、字面の規則だけ
// ここに置く。エディタ・HTML・Word・コードの書き出しが同じ判定を使う

/// フェンスの情報文字列を言語とファイル名に分ける（ADR-0008）。
/// `lang` に `python:aaa.py` を丸ごと入れると色分けが言語を見つけられない。
export function splitFenceInfo(info: string): {
  lang: string;
  fileName: string | null;
} {
  const trimmed = info.trim();
  const colon = trimmed.indexOf(":");
  if (colon < 0) return { lang: trimmed, fileName: null };
  const fileName = trimmed.slice(colon + 1);
  return { lang: trimmed.slice(0, colon), fileName: fileName || null };
}
