// 装飾を持った文字のかたまり（ADR-0068）。**記号は落とすが装飾は落とさない** —
// 素の文字にすると、書いた人が Word / PowerPoint 側で付け直すことになる。
// スライド（Lezer で解析）と Word（markdown-it で解析）が同じ形に落とし、
// 出力側はこの形だけを見る。解析器は 2 つのまま（理由は ADR-0068）

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /// `==印==`（Word は黄色の地。PowerPoint は今は捨てる）
  highlight?: boolean;
  /// リンクの行き先（`[題](url)` の url）
  link?: string;
  /// 文字色（`RRGGBB`。ADR-0061）
  color?: string;
};

/// 装飾を落とした文字（題名・発表者ノート・テストが使う）
export function plainText(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join("");
}

/// 文字以外が全部同じか（隣どうしを繋げるかの判断）
export function sameStyle(a: Run, b: Run): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.code === b.code &&
    a.highlight === b.highlight &&
    a.link === b.link &&
    a.color === b.color
  );
}
