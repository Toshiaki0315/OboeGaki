// アシスタントの画面に出す言葉（ADR-0025 追記）。
//
// App から切り出した純関数。場つなぎ（「読み込んでいます…」）の
// 出し引きは順序に敏感で、間違えると断りが永久に消える — 表示の
// 規則そのものをここで試験できる形に固める。

import type { LlmEngine } from "./settings";

/// モデルの読み込み待ちの場つなぎ。**6 分の沈黙は壊れて見える**。
export const LOADING_NOTICE = "モデルを読み込んでいます…";

/// fm が無いときの案内（ADR-0071）
export const FM_MISSING =
  "macOS の AI（fm コマンド）が見つかりません。macOS 27 以降で、Apple Intelligence を入にすると使えます。";

/// fm の使用条件にまだ同意していないときの案内（実機 2026-11-21: 同意前の fm は
/// 英文の警告を出して止まる。同意は Mac の全員に効くので管理者として打つ）
export const FM_NEEDS_AGREEMENT =
  "macOS の AI（fm）の使用条件にまだ同意していません。ターミナルで `sudo fm license` を実行して同意すると使えます。";

/// ローカルLLM の断りを、画面に出す言葉にする。
/// **動いているのに「動いているか確かめて」は嘘になる**ので、時間切れは
/// 別の言葉にする。404 はモデル名の間違いなので、直し方まで言う。
export function llmErrorText(
  code: string,
  minutes: number,
  model: string,
  engine: LlmEngine = "ollama",
): string {
  // fm（ADR-0071）にはモデル名もポートも無い。断りは fm の言い分をそのまま見せる
  if (engine === "fm") {
    if (code.startsWith("not-running")) return FM_MISSING;
    if (code.startsWith("fm-license")) return FM_NEEDS_AGREEMENT;
    if (code.startsWith("timed-out")) {
      return `${minutes} 分待っても答えが返りませんでした（設定で延ばせます）。`;
    }
    return `macOS の AI（fm）から答えを受け取れませんでした: ${code.replace(/^failed: /, "")}`;
  }
  if (code.startsWith("not-running")) {
    return "Ollama が動いていません。`ollama serve` で動かすか、https://ollama.com から入れてください。";
  }
  if (code.startsWith("timed-out")) {
    return `${minutes} 分待っても答えが返りませんでした。大きいモデルは読み込みだけで数分かかります（設定で延ばせます）。`;
  }
  if (code.includes("HTTP 404")) {
    return (
      `モデル「${model}」が Ollama に入っていません。設定のモデル名を、` +
      `入っているものに合わせてください（\`ollama pull ${model}\` で入れることもできます）。`
    );
  }
  return `答えを受け取れませんでした: ${code}`;
}

/// 場つなぎは答えがまだ無いときだけ。**先に届いた断りや答えを
/// 上書きしない** — 404 の断りは生成の起動確認より速く返ることがあり、
/// 上書きすると「読み込んでいます…」のまま永久に止まる（実機で発生）。
export function loadingNotice(current: string): string {
  return current === "" ? LOADING_NOTICE : current;
}

/// 流れてきたぶんを継ぎ足す。最初のひとかけらが届いたら場つなぎを消す
/// （消さないと場つなぎの後ろに答えが繋がって見える）。
export function appendChunk(current: string, piece: string): string {
  return (current === LOADING_NOTICE ? "" : current) + piece;
}
