// 日本語の文体を見る（TASKS 4-11 / U-4）。参照実装 core/style_check.py の移植。
//
// iA Writer の Style Check（決まり文句・冗長表現の指摘）の日本語版。
// **指摘するだけで、直さない** — 書き手の言葉を機械が上書きしない。
//
// **形態素解析は使わない。** 品詞で見ると辞書と実行時間が要るうえ、外すと
// 的外れな指摘になる。**言い回しの辞書**に絞れば、当たるものだけを確実に
// 当てられる。外れを出さないことを取る — **1 つの誤検出が、以後全部の
// 指摘を無視させる**。

export type StyleKind =
  | "redundant"
  | "double-negative"
  | "tautology"
  | "particle-run"
  | "long-sentence";

export type Finding = {
  /// 本文の先頭からの位置（UTF-16 単位 = CM6 のオフセット）。
  start: number;
  length: number;
  kind: StyleKind;
  /// **どう書けるか**を出す（何が悪いかだけ言われても動けない）。
  message: string;
};

/// 1 文の上限（字）。
///
/// **厳しくしない。** 日本語の実用文は 60〜80 字が読みやすいとされるが、
/// そこで切ると技術文書は指摘だらけになる。**明らかに長いものだけ**に
/// 当てて、指摘そのものが無視されないようにする。
export const MAX_SENTENCE = 100;

/// 同じ助詞が続いてよい回数。2 つ（`私の友人の家`）はふつうに書く。
const PARTICLE_RUN_MIN = 3;
/// `の` の前に置ける語の長さ（字）。**長い塊を数えない** — 上限が無いと
/// 節をまたいだ並びを 1 つの連なりと見なす（参照実装の実測で誤検出だらけ）。
const PARTICLE_UNIT_MAX = 6;

/// **こそあど（`その` `この`）は数えない。** そこの `の` は連体詞の一部で、
/// 「〜の〜の〜」の連なりではない。
const PARTICLE_RUN = new RegExp(
  `(?:[^\\s。、の]{0,${PARTICLE_UNIT_MAX - 1}}[^\\s。、のこそあど]の){${PARTICLE_RUN_MIN},}`,
  "g",
);

/// 文章ではない行。**表の行と区切り線**は文として数えない
/// （`| --- | ---- |` を「1 文が長い」と言われても直しようがない）。
const NOT_PROSE = /^\s*(\||[-=_*]{3,}\s*$|>\s*\||#{1,6}\s*$)/;

/// 言い回しの辞書。品詞は見ない。
const RULES: { pattern: RegExp; kind: StyleKind; message: string }[] = [
  // **否定は否定で言い換える。** まとめて「できます」と出すと、
  // **意味が逆になる言い換え**になり、指摘より悪い
  {
    pattern: /することができ(ない|ません)/g,
    kind: "redundant",
    message: "「できません」で足ります",
  },
  {
    pattern: /することができ(る|ます)/g,
    kind: "redundant",
    message: "「できます」で足ります",
  },
  {
    pattern: /することが可能/g,
    kind: "redundant",
    message: "「できます」で足ります",
  },
  {
    pattern: /という点において/g,
    kind: "redundant",
    message: "「という点で」で足ります",
  },
  {
    pattern: /を行うことができ/g,
    kind: "redundant",
    message: "動詞そのもので言えます",
  },
  {
    pattern: /なくはない/g,
    kind: "double-negative",
    message: "二重否定です。言い切れませんか",
  },
  {
    pattern: /ないことはない/g,
    kind: "double-negative",
    message: "二重否定です。言い切れませんか",
  },
  {
    pattern: /なくもない/g,
    kind: "double-negative",
    message: "二重否定です。言い切れませんか",
  },
  {
    pattern: /まず最初に/g,
    kind: "tautology",
    message: "「まず」か「最初に」のどちらかで足ります",
  },
  {
    pattern: /違和感を感じ/g,
    kind: "tautology",
    message: "「違和感を覚え」と書けます",
  },
  { pattern: /今の現状/g, kind: "tautology", message: "「現状」で足ります" },
  {
    pattern: /一番最(適|初|後)/g,
    kind: "tautology",
    message: "「最—」だけで足ります",
  },
  {
    pattern: /あらかじめ予(約|定)/g,
    kind: "tautology",
    message: "「予—」だけで足ります",
  },
  {
    pattern: /後(で|から)後悔/g,
    kind: "tautology",
    message: "「後悔」だけで足ります",
  },
  {
    pattern: /返事を返/g,
    kind: "tautology",
    message: "「返事をし」と書けます",
  },
];

/// 本文を見て、気づいたところを返す。**直さない。**
export function checkStyle(text: string): Finding[] {
  const found: Finding[] = [];
  for (const { offset, line } of bodyLines(text)) {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line)) !== null) {
        found.push({
          start: offset + match.index,
          length: match[0].length,
          kind: rule.kind,
          message: rule.message,
        });
      }
    }
    PARTICLE_RUN.lastIndex = 0;
    let run: RegExpExecArray | null;
    while ((run = PARTICLE_RUN.exec(line)) !== null) {
      found.push({
        start: offset + run.index,
        length: run[0].length,
        kind: "particle-run",
        message: "「の」が続いています。区切れませんか",
      });
    }
    // **行の長さでは数えない** — 短い文が並んでいるだけなら読みにくくはない
    for (const sentence of sentences(line, offset)) {
      const body = sentence.text.trim();
      if (body.length > MAX_SENTENCE) {
        found.push({
          start: sentence.start,
          length: sentence.text.length,
          kind: "long-sentence",
          message: `1 文が ${body.length} 字あります。切れませんか`,
        });
      }
    }
  }
  found.sort((a, b) => a.start - b.start || a.length - b.length);
  return found;
}

/// `(位置, 文)`。句点で切る。
function sentences(
  text: string,
  offset: number,
): { start: number; text: string }[] {
  const found: { start: number; text: string }[] = [];
  let start = 0;
  const ends = /[。！？]/g;
  let match: RegExpExecArray | null;
  while ((match = ends.exec(text)) !== null) {
    const end = match.index + 1;
    found.push({ start: offset + start, text: text.slice(start, end) });
    start = end;
  }
  if (text.slice(start).trim()) {
    found.push({ start: offset + start, text: text.slice(start) });
  }
  return found;
}

/// コードの中と front matter を除いた行。
///
/// **コード例の日本語は文章ではない。** 数え方はタグやリンクの走査と
/// 揃える（別に書くと「リンクは拾うのに文体は見ない」のような食い違いが出る）。
function bodyLines(text: string): { offset: number; line: string }[] {
  const found: { offset: number; line: string }[] = [];
  let offset = 0;
  let inFence = false;
  let inFrontMatter = false;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (index === 0 && trimmed === "---") {
      inFrontMatter = true;
      offset += line.length + 1;
      return;
    }
    if (inFrontMatter) {
      if (trimmed === "---") inFrontMatter = false;
      offset += line.length + 1;
      return;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      offset += line.length + 1;
      return;
    }
    if (!inFence && !NOT_PROSE.test(line)) {
      found.push({ offset, line });
    }
    offset += line.length + 1;
  });
  return found;
}
