// ブロック widget と表の StateField（ADR-0035）。CM6 はブロック構造を変える装飾を
// plugin 由来に許さないので、表・数式・図・囲みは StateField から出す。
// 差分更新（zones の間引き）もここ。19-2 で live-preview.ts から分けた

import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
  type EditorState,
  type Range,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { renderMath } from "./math";
import {
  type NoteContainer,
  noteContainers,
  UNKNOWN_NOTE_KIND,
} from "./note-container";
import { detailsContainers, type DetailsContainer } from "./details-container";
import { type MermaidTheme } from "./mermaid";

import {
  diagramThemeField,
  revealModeSwitched,
  setDiagramTheme,
  sourceModeField,
  touchesBlockZone,
} from "./live-preview-reveal";
import { tableData } from "./live-preview-table-data";
import {
  MathWidget,
  MermaidWidget,
  SummaryWidget,
  TableWidget,
} from "./live-preview-widgets";

/// 各行に行クラスを付ける（引用の縦バー・コードブロックの背景）。
/// 行の帯を掛ける。**上下の端には印を付ける**（帯の内側に余白を作るため。
/// 端が分からないと、文字が縁にくっついて窮屈に見える）。
export function pushLineClass(
  out: Range<Decoration>[],
  state: EditorState,
  from: number,
  to: number,
  className: string,
) {
  const lines: number[] = [];
  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    lines.push(line.from);
    if (line.to >= to) break;
    pos = line.to + 1;
  }
  lines.forEach((start, index) => {
    const edges =
      (index === 0 ? ` ${className}-first` : "") +
      (index === lines.length - 1 ? ` ${className}-last` : "");
    out.push(Decoration.line({ class: className + edges }).range(start));
  });
}

/// 表の装飾を計算する（ADR-0035）。範囲外にいる間は HTML の table に
/// 置き換え、触れている間は生のソース（表単位リビール = ADR-0003 決定 3）。
///
/// **ViewPlugin ではなく StateField から提供する。** CM6 はブロック構造を
/// 変える装飾（block widget・改行をまたぐ replace）を plugin 由来の
/// 装飾に許さない（実機で発覚 2026-09-04）。表は文書全体を見るが、
/// Table ノードの走査は木の上部だけで済むので軽い。
export function tableDecorations(state: EditorState): Range<Decoration>[] {
  if (state.field(sourceModeField, false)) return [];
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") {
        // 表はトップレベルのブロック。中まで潜る必要は無い
        return node.node.parent === null || node.name === "Document"
          ? undefined
          : false;
      }
      if (!touchesBlockZone(state, node.from, node.to)) {
        out.push(
          Decoration.replace({
            widget: new TableWidget(tableData(state, node.node)),
            block: true,
          }).range(node.from, node.to),
        );
      }
      return false;
    },
  });
  return out;
}

/// 表の範囲とリビール状態。DecorationSet は不変オブジェクトなので、
/// 付帯情報は WeakMap でぶら下げる（field の値を DecorationSet のまま
/// 保ち、provide とテストを単純にするため）
type TableMeta = {
  zones: { from: number; to: number }[];
  revealKey: string;
  /// 計算した時点で構文解析が届いていた位置（blockWidgetMeta と同じ理由）
  parsedTo: number;
};
const tableMeta = new WeakMap<DecorationSet, TableMeta>();

function tableZones(state: EditorState): { from: number; to: number }[] {
  const zones: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Table") {
        zones.push({ from: node.from, to: node.to });
        return false;
      }
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return zones;
}

function revealKeyOf(
  state: EditorState,
  zones: { from: number; to: number }[],
): string {
  return zones
    .map((zone, index) =>
      touchesBlockZone(state, zone.from, zone.to) ? index : -1,
    )
    .filter((index) => index >= 0)
    .join(",");
}

/// ゾーンの範囲に掛かるトップレベルの Table（0〜n 個）。1 点で resolve すると、
/// 表の先頭の `|` を消して始点がずれたときや、ゾーンの中で表が 2 つに割れた
/// ときに見失う（再レビュー 2026-09-25 / 21-5）。全再計算と同じくトップレベルだけ
function tablesWithin(
  state: EditorState,
  from: number,
  to: number,
): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    from: Math.min(from, state.doc.length),
    to: Math.min(to, state.doc.length),
    enter: (node) => {
      if (node.name === "Table") {
        if (node.node.parent?.name === "Document") found.push(node.node);
        return false;
      }
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return found;
}

/// 1 つの表ゾーンの装飾を今の状態で作り直す（差分更新用）。ゾーンの範囲にある
/// 表を全部拾い、その範囲（新しいゾーン）も返す。表が無ければ空
function tableZoneDecorations(
  state: EditorState,
  zone: { from: number; to: number },
): { ranges: Range<Decoration>[]; bounds: { from: number; to: number }[] } {
  // ソースモードでは描かないがゾーンは据え置く（捨てると以後の打鍵が毎回
  // 全再計算に落ちる。21-6）
  if (state.field(sourceModeField, false))
    return { ranges: [], bounds: [zone] };
  const ranges: Range<Decoration>[] = [];
  const bounds: { from: number; to: number }[] = [];
  for (const node of tablesWithin(state, zone.from, zone.to)) {
    bounds.push({ from: node.from, to: node.to });
    if (touchesBlockZone(state, node.from, node.to)) continue;
    ranges.push(
      Decoration.replace({
        widget: new TableWidget(tableData(state, node)),
        block: true,
      }).range(node.from, node.to),
    );
  }
  return { ranges, bounds };
}

/// 触った表だけ差し替える（blockWidgetField の refreshZones と同じ作法）。
/// 以前は表の中で 1 字打つたびに文書中の**全表**を作り直していて、表が多い
/// 文書で打鍵 p95 が 16ms に最も近づく経路だった（レビュー 2026-09-24 / 21-3）
function refreshTableZones(
  state: EditorState,
  set: DecorationSet,
  meta: TableMeta,
  indices: number[],
): DecorationSet {
  const zones = [...meta.zones];
  // ゾーンは 0〜n 個に置き換わるので、後ろから処理して添字をずらさない
  for (const index of [...new Set(indices)].sort((a, b) => b - a)) {
    const zone = zones[index];
    if (!zone) continue;
    const { ranges, bounds } = tableZoneDecorations(state, zone);
    const from = Math.min(zone.from, ...bounds.map((b) => b.from));
    const to = Math.max(zone.to, ...bounds.map((b) => b.to));
    set = set.update({
      filterFrom: from,
      filterTo: to,
      filter: () => false,
      add: ranges,
      sort: true,
    });
    zones.splice(index, 1, ...bounds);
  }
  const next = { ...meta, zones, revealKey: revealKeyOf(state, zones) };
  tableMeta.set(set, next);
  return set;
}

/// この変更が既にあるゾーンの中だけで済んでいるか（行の構造を変えない =
/// 改行を足しも消しもしない）。そうなら触ったゾーンの添字を返し、外に
/// 触れる・行が増減する変更なら null（ブロックの生成・分割・破壊があり得る）
function zonesTouchedInside(
  zones: { from: number; to: number }[],
  tr: NearTr,
): number[] | null {
  const touched = new Set<number>();
  let outside = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (outside) return;
    const index = zones.findIndex(
      (zone) => zone.from <= fromA && toA <= zone.to,
    );
    if (index < 0 || inserted.toString().includes("\n")) {
      outside = true;
      return;
    }
    if (
      tr.startState.doc.lineAt(fromA).number !==
      tr.startState.doc.lineAt(toA).number
    ) {
      outside = true;
      return;
    }
    touched.add(index);
  });
  return outside ? null : [...touched];
}

/// 変更が既にある表のすぐ上・すぐ下の行に触れているか。表の最後の行は `|` を
/// 持たないことがある（続きの行も行として数える）ので、`|` の記号判定では
/// 下の空行を消して表が伸びるのを拾えなかった（21-12）。ゾーンは位置順なので、
/// 変更より前で終わる最後の表と、変更より後で始まる最初の表だけ見る
function editBesideTable(
  zones: { from: number; to: number }[],
  tr: NearTr,
): boolean {
  const doc = tr.startState.doc;
  let beside = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (beside) return;
    const fromLine = doc.lineAt(fromA).number;
    const toLine = doc.lineAt(toA).number;
    let before: { from: number; to: number } | null = null;
    for (const zone of zones) {
      if (zone.to < fromA) {
        before = zone;
        continue;
      }
      if (zone.from > toA) {
        if (doc.lineAt(zone.from).number - 1 <= toLine) beside = true;
        break;
      }
      beside = true; // 表に重なる（中だけの編集は呼び手が先に除いている）
      break;
    }
    if (!beside && before && doc.lineAt(before.to).number + 1 >= fromLine) {
      beside = true;
    }
  });
  return beside;
}

function computeTableSet(state: EditorState): DecorationSet {
  const set = RangeSet.of(tableDecorations(state), true);
  const zones = tableZones(state);
  tableMeta.set(set, {
    zones,
    revealKey: revealKeyOf(state, zones),
    parsedTo: syntaxTree(state).length,
  });
  return set;
}

/// この編集は対象ブロックに関わり得るか。変更行の前後 1 行（旧文書側も）
/// または挿入テキストが `marker` に当たるときだけ真。ブロックの生成・破壊は
/// 必ずその記号の近くで起きる、という近似
function editNearMarker(
  marker: RegExp,
  tr: {
    startState: EditorState;
    newDoc: EditorState["doc"];
    changes: {
      iterChanges: (
        f: (
          fromA: number,
          toA: number,
          fromB: number,
          toB: number,
          inserted: { toString: () => string },
        ) => void,
      ) => void;
    };
  },
): boolean {
  let near = false;
  const hasMarkerAround = (
    doc: EditorState["doc"],
    from: number,
    to: number,
  ) => {
    const start = doc.lineAt(Math.min(from, doc.length)).number;
    const end = doc.lineAt(Math.min(to, doc.length)).number;
    for (
      let n = Math.max(1, start - 1);
      n <= Math.min(doc.lines, end + 1);
      n++
    ) {
      if (marker.test(doc.line(n).text)) return true;
    }
    return false;
  };
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (near) return;
    if (marker.test(inserted.toString())) {
      near = true;
      return;
    }
    if (
      hasMarkerAround(tr.newDoc, fromB, toB) ||
      hasMarkerAround(tr.startState.doc, fromA, toA)
    ) {
      near = true;
    }
  });
  return near;
}

type NearTr = Parameters<typeof editNearMarker>[1];

/// 変更の位置が、旧文書か新文書で **HTML の塊**（HTMLBlock・コメント・処理命令）に
/// 触れているか。型 4（`<!X…`）は行に `>` が 1 つあれば閉じ、型 6/7（`<div>` など）
/// は空行まで飲むので、記号の正規表現では拾い切れない（bare `>` を記号にすると
/// 引用行で毎打鍵が全再計算になる）。木で見れば O(log n) で済む（21-8）
const HTML_BLOCKS = new Set([
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
]);
/// その位置を包む HTML の塊の範囲。無ければ null（前後どちら側の字でも見る）
function htmlBlockAt(
  state: EditorState,
  pos: number,
): { from: number; to: number } | null {
  const at = Math.min(pos, state.doc.length);
  // その位置だけでなく、同じ行の中身の先頭と行末も見る。塊のノードは行頭の
  // 字下げの後（`<`）から始まるので、`  <an>` の字下げの中の編集は位置だけ
  // 見ると塊の外に見え、塊が壊れても数え直さなかった（21-12）
  const line = state.doc.lineAt(at);
  const lead = line.text.length - line.text.trimStart().length;
  for (const probe of [at, line.from + lead, line.to]) {
    for (const side of [-1, 1] as const) {
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(probe, side);
      for (; node; node = node.parent) {
        if (HTML_BLOCKS.has(node.name)) return { from: node.from, to: node.to };
      }
    }
  }
  return null;
}

/// 変更で HTML の塊の**範囲が変わったか**。塊が生まれた・消えた・伸び縮みした
/// （型 4 の `>`・型 6 の空行で閉じる等）ときだけ真。塊の中の普通の打鍵は範囲が
/// 写像どおりなので偽 — 以前は「触れたか」で見ていて、`<div>` の中で打つたびに
/// 表と数式を全部数え直していた（p95 +2ms。再レビュー 2026-09-25 / 21-9）
function editTouchesHtmlBlock(tr: {
  startState: EditorState;
  state: EditorState;
  changes: {
    iterChangedRanges: (
      f: (fromA: number, toA: number, fromB: number, toB: number) => void,
    ) => void;
    mapPos: (pos: number, assoc?: number) => number;
  };
}): boolean {
  let changed = false;
  const differs = (oldPos: number, newPos: number) => {
    const before = htmlBlockAt(tr.startState, oldPos);
    const after = htmlBlockAt(tr.state, newPos);
    if (!before && !after) return false;
    if (!before || !after) return true;
    return (
      tr.changes.mapPos(before.from, -1) !== after.from ||
      tr.changes.mapPos(before.to, 1) !== after.to
    );
  };
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (changed) return;
    // 末尾側は、旧か新のどちらかで幅があるときに見る。純粋な挿入（fromA === toA）
    // でも新文書の toB は先へ進んでいて、挿入の**後ろ側**に塊が生まれうる
    // （`foo<div>` の `<div>` の前で Enter・`x\n\n<div>` の貼り付け。21-9 で
    // toA だけ見て取りこぼした = 21-10）
    changed =
      differs(fromA, fromB) ||
      ((toA !== fromA || toB !== fromB) && differs(toA, toB)) ||
      nextLineIsTagOnly(tr.startState, toA) ||
      nextLineIsTagOnly(tr.state, toB);
  });
  return changed;
}

/// タグだけの行（`<x-y>` `</div>` など = HTML ブロック型 7 の開き）。型 7 は段落を
/// 割り込めないので、**上の行**が段落かどうかで塊になったりならなかったりする。
/// 変更の位置には塊が見えないまま次の行の塊が生まれ・消えるので、変更の次の行が
/// これなら数え直す（再レビュー 2026-09-25 / 21-10。21-9 以前から在った穴）
// lezer（@lezer/markdown の HTMLBlockStyle）と同じ判定。型 7 はタグだけの行で、
// かつ型 1（script / pre / style）・型 6（div・details・p など）のどれでもない
// もの。型 1・6 は段落を割り込めるので上の行に左右されない — 数えると `</div>` の
// 直上の段落を打つたびに全部数え直していた（p95 0.6ms → 2.4ms。21-11）
const TYPE7_RE =
  /^\s*(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(\s+[a-z:_][\w-.]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)\s*$/i;
const TYPE1_RE = /^<(?:script|pre|style)(?:\s|>|$)/i;
const TYPE6_RE =
  /^\s*<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i;
function isType7Line(text: string): boolean {
  const rest = text.replace(/^ {0,3}/, "");
  // 行頭に空白のある行は、上の行がリスト項目かどうかで所属が変わり、型 6 の塊の
  // 終わりも変わる（`- 項目\n  </details>` の `- ` を消すと塊が伸びて下の表を飲む）。
  // 型 1・6 を外すのは行頭に空白の無い行だけ（再レビュー 2026-09-25 / 21-12）
  if (rest.length !== text.length) {
    return TYPE7_RE.test(rest) || TYPE6_RE.test(rest) || TYPE1_RE.test(rest);
  }
  return TYPE7_RE.test(rest) && !TYPE1_RE.test(rest) && !TYPE6_RE.test(rest);
}
function nextLineIsTagOnly(state: EditorState, pos: number): boolean {
  // 塊の中の打鍵なら、次の行は同じ塊の一部（`<div>` の中で `</div>` の上を打つ等）。
  // 塊の伸び縮みは範囲の比較が見るので、ここは塊の**外**だけ（毎打鍵の全再計算を
  // 増やさない）
  if (htmlBlockAt(state, pos)) return false;
  const line = state.doc.lineAt(Math.min(pos, state.doc.length));
  if (line.number >= state.doc.lines) return false;
  return isType7Line(state.doc.line(line.number + 1).text);
}

/// 行から先を**末まで飲み込む**ブロックの開閉（フェンス・HTML コメント・
/// `<pre>` など。CommonMark の HTML ブロック型 3〜5 = `<?…?>`・`<!X…>`・
/// `<![CDATA[…]]>` も空行を越えて閉じまで飲む。21-7）。離れた場所の表・数式・図がこれに飲まれると木から消えるので、
/// 近くの編集は全部数え直す（再レビュー 2026-09-25 / 21-6。以前は `|` と `$$` と
/// フェンスだけで、`<!--` や `<pre>` を見ていなかった）
const SWALLOWING_RE =
  /```|~~~|<!--|-->|<\/?(?:pre|script|style|textarea)\b|<\?|\?>|<![A-Za-z]|<!\[CDATA\[|\]\]>/i;
const editOpensBlock = (tr: NearTr) => editNearMarker(SWALLOWING_RE, tr);
const editNearTables = (tr: NearTr) =>
  editNearMarker(
    /\||\$\$|```|~~~|<!--|-->|<\/?(?:pre|script|style|textarea)\b|<\?|\?>|<![A-Za-z]|<!\[CDATA\[|\]\]>/i,
    tr,
  );
// 数式（$$）・図（フェンス）・:::note の生成・破壊はこの記号の近くで起きる
const editNearBlockWidgets = (tr: NearTr) =>
  editNearMarker(
    /\$\$|```|~~~|:::|<\/?details>|<!--|-->|<\/?(?:pre|script|style|textarea)\b|<\?|\?>|<![A-Za-z]|<!\[CDATA\[|\]\]>/i,
    tr,
  );

/// ```mermaid のフェンスなら中身。違えば null。
export function mermaidCode(
  state: EditorState,
  node: SyntaxNode,
): string | null {
  const info = node.getChild("CodeInfo");
  const language = info ? state.sliceDoc(info.from, info.to).trim() : "";
  if (language !== "mermaid") return null;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  if (last.from <= first.to) return null;
  const code = state
    .sliceDoc(first.to + 1, last.from)
    .replace(/\n$/, "")
    .trim();
  return code || null;
}

/// 行をまたぐ装飾（数式ブロック・Mermaid の図）。
///
/// **StateField から提供する。** CM6 はブロック構造を変える装飾を plugin
/// 由来の装飾に許さず、**投げる**（画面が真っ白になる。ADR-0035 が表で
/// 踏んだ罠を、数式と図でもう一度踏んだ = 実機で発覚 2026-09-04）。
/// コードフェンスの範囲（トップレベルのみ）。:::note の除外に使う。
function fencedRanges(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        out.push({ from: node.from, to: node.to });
        return false;
      }
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return out;
}

/// フェンスの中の `:::` や `<details>` はコード例であって囲みではない
/// （レビュー 2026-09-04）。
function outsideFences<T extends { from: number; to: number }>(
  blocks: T[],
  fences: { from: number; to: number }[],
): T[] {
  if (fences.length === 0) return blocks;
  return blocks.filter(
    (block) =>
      !fences.some((fence) => block.from < fence.to && block.to > fence.from),
  );
}

/// 1 つの `:::note` の装飾。帯は常に、区切りの隠しは「綴りが分かって
/// いて触れていないとき」だけ。
function noteZoneDecorations(
  state: EditorState,
  note: NoteContainer,
  out: Range<Decoration>[],
): void {
  // **色を付けるのは中身の行だけ。** 区切り（`:::note …` と `:::`）は
  // 書き方であって中身ではないので、帯に含めない（実機報告 2026-09-04:
  // 「設定の文も色がついている」）
  const body = {
    from: state.doc.lineAt(note.open.to).to + 1,
    to: state.doc.lineAt(note.close.from).from - 1,
  };
  if (body.to >= body.from) {
    pushLineClass(
      out,
      state,
      body.from,
      body.to,
      `cm-note-${note.kind} cm-note-line`,
    );
  }
  // **知らない綴りは区切り行も隠さない**（間違いに気づく手掛かりを残す）。
  // キャレットが触れている間も生のまま（他のブロックと同じ作法）
  if (
    note.kind === UNKNOWN_NOTE_KIND ||
    touchesBlockZone(state, note.from, note.to)
  ) {
    return;
  }
  out.push(Decoration.replace({}).range(note.open.from, note.open.to));
  out.push(Decoration.replace({}).range(note.close.from, note.close.to));
}

/// 折りたたみ 1 つぶんの装飾（6-2）。
///
/// **畳むのは CM6 の折りたたみに任せる**（ガターの ▾ / ▸）。ここは
/// 見た目だけ — 呼び名の行を差し替え、中身に左の線を引き、閉じを隠す。
function detailsZoneDecorations(
  state: EditorState,
  entry: DetailsContainer,
  out: Range<Decoration>[],
): void {
  const body = {
    from: state.doc.lineAt(entry.open.to).to + 1,
    to: state.doc.lineAt(entry.close.from).from - 1,
  };
  if (body.to >= body.from) {
    pushLineClass(out, state, body.from, body.to, "cm-details-line");
  }
  // 触れている間は生のまま（他のブロックと同じ作法）
  if (touchesBlockZone(state, entry.from, entry.to)) return;
  out.push(
    Decoration.replace({ widget: new SummaryWidget(entry.summary) }).range(
      entry.open.from,
      entry.open.to,
    ),
  );
  out.push(Decoration.replace({}).range(entry.close.from, entry.close.to));
}

/// 1 つの数式ブロックの装飾（触れていなければ絵に置き換える）。
/// 閉じの無いブロック（書きかけ）は絵にしない — 生のまま見せる。
/// パーサは「文書末まで」を返すので、閉じの判定はここが持つ
function mathBlockClosed(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const rows = state.sliceDoc(from, to).split("\n");
  return rows.length >= 2 && /^(?:>\s*)*\$\$\s*$/.test(rows[rows.length - 1]);
}

function mathZoneDecorations(
  state: EditorState,
  from: number,
  to: number,
  out: Range<Decoration>[],
): void {
  // リビールは**式全体**（途中の行だけ生に戻すと、式の断片と絵が
  // 同時に見えて読めない）
  if (touchesBlockZone(state, from, to)) return;
  const source = state.sliceDoc(from, to);
  const rows = source.split("\n");
  const closed = mathBlockClosed(state, from, to);
  const latex = closed ? rows.slice(1, -1).join("\n").trim() : "";
  const mathml = latex ? renderMath(latex, true) : null;
  if (!mathml) return;
  out.push(
    Decoration.replace({
      widget: new MathWidget(mathml, true),
      block: true,
    }).range(from, to),
  );
}

/// 1 つの mermaid フェンスの装飾。
function mermaidZoneDecorations(
  state: EditorState,
  node: SyntaxNode,
  theme: MermaidTheme,
  out: Range<Decoration>[],
): void {
  const code = mermaidCode(state, node);
  if (code === null) return;
  if (touchesBlockZone(state, node.from, node.to)) return;
  out.push(
    Decoration.replace({
      widget: new MermaidWidget(code, theme),
      block: true,
    }).range(node.from, node.to),
  );
}

export function blockWidgetDecorations(
  state: EditorState,
  notes: NoteContainer[] = outsideFences(
    noteContainers(state.doc),
    fencedRanges(state),
  ),
  details: DetailsContainer[] = outsideFences(
    detailsContainers(state.doc),
    fencedRanges(state),
  ),
): Range<Decoration>[] {
  if (state.field(sourceModeField, false)) return [];
  const out: Range<Decoration>[] = [];
  // `:::note` の囲み（B-3）。行の装飾なので木のノードは要らない
  for (const note of notes) {
    noteZoneDecorations(state, note, out);
  }
  // 折りたたみ（6-2）。こちらも行の並びだけで見つける
  for (const entry of details) {
    detailsZoneDecorations(state, entry, out);
  }
  const theme = state.field(diagramThemeField, false) ?? "light";
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "MathBlock") {
        mathZoneDecorations(state, node.from, node.to, out);
        return false;
      }
      if (node.name === "FencedCode") {
        mermaidZoneDecorations(state, node.node, theme, out);
        return false;
      }
      // ブロックはトップレベル。中まで潜る必要は無い
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return out;
}

/// 1 ゾーンぶんの装飾を、今の選択状態で作り直す（差分更新用）。
function zoneDecorations(
  state: EditorState,
  zone: { from: number; to: number },
  notes: NoteContainer[],
  details: DetailsContainer[],
): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  if (state.field(sourceModeField, false)) return out;
  const note = notes.find((n) => n.from === zone.from && n.to === zone.to);
  if (note) {
    noteZoneDecorations(state, note, out);
    return out;
  }
  const entry = details.find((d) => d.from === zone.from && d.to === zone.to);
  if (entry) {
    detailsZoneDecorations(state, entry, out);
    return out;
  }
  let node = syntaxTree(state).resolveInner(
    Math.min(zone.from, state.doc.length),
    1,
  );
  while (
    node.parent &&
    node.name !== "MathBlock" &&
    node.name !== "FencedCode"
  ) {
    node = node.parent;
  }
  if (node.name === "MathBlock") {
    mathZoneDecorations(state, node.from, node.to, out);
  } else if (node.name === "FencedCode") {
    const theme = state.field(diagramThemeField, false) ?? "light";
    mermaidZoneDecorations(state, node.node, theme, out);
  }
  return out;
}

/// 数式・図・囲みの「ゾーン」/// 数式・図・囲みの「ゾーン」（リビール判定と再計算の間引きに使う）。
function blockWidgetZones(
  state: EditorState,
  notes: NoteContainer[],
  details: DetailsContainer[],
): { from: number; to: number }[] {
  const zones: { from: number; to: number }[] = [];
  for (const note of notes) {
    zones.push({ from: note.from, to: note.to });
  }
  for (const entry of details) {
    zones.push({ from: entry.from, to: entry.to });
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "MathBlock") {
        // 閉じの無い式（書きかけ）は文書末まで伸びる。ゾーンにすると下の
        // :::note などを包み込み、差し替えのたびにその装飾を消してしまう
        // （再レビュー 2026-09-25 / 21-5）。mathZoneDecorations と同じ判定
        if (mathBlockClosed(state, node.from, node.to)) {
          zones.push({ from: node.from, to: node.to });
        }
        return false;
      }
      if (node.name === "FencedCode") {
        if (mermaidCode(state, node.node) !== null) {
          zones.push({ from: node.from, to: node.to });
        }
        return false;
      }
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return zones;
}

type BlockWidgetMeta = {
  zones: { from: number; to: number }[];
  /// ゾーン単位の差分更新（リビール切替）に使うノートの控え
  notes: NoteContainer[];
  /// 同じく折りたたみの控え（6-2）
  details: DetailsContainer[];
  revealKey: string;
  /// 計算した時点で構文解析が届いていた位置。ここより先へ解析が進んだら
  /// 数え直す（オブジェクト同一性で見ると打鍵のたびに全再計算になる —
  /// レビュー 2026-09-04 で実測 p95 17〜25ms の退行として発覚）
  parsedTo: number;
};
const blockWidgetMeta = new WeakMap<DecorationSet, BlockWidgetMeta>();

function computeBlockWidgetSet(state: EditorState): DecorationSet {
  // 全行走査（noteContainers）は 1 回だけ。装飾とゾーンで共有する
  const fences = fencedRanges(state);
  const notes = outsideFences(noteContainers(state.doc), fences);
  const details = outsideFences(detailsContainers(state.doc), fences);
  const set = RangeSet.of(blockWidgetDecorations(state, notes, details), true);
  const zones = blockWidgetZones(state, notes, details);
  blockWidgetMeta.set(set, {
    zones,
    notes,
    details,
    revealKey: revealKeyOf(state, zones),
    parsedTo: syntaxTree(state).length,
  });
  return set;
}

/// 位置だけを写す（囲みの控えを編集に追従させる）。
function mapContainer<
  T extends {
    from: number;
    to: number;
    open: { from: number; to: number };
    close: { from: number; to: number };
  },
>(block: T, changes: { mapPos: (pos: number, assoc: number) => number }): T {
  return {
    ...block,
    from: changes.mapPos(block.from, 1),
    to: changes.mapPos(block.to, -1),
    open: {
      from: changes.mapPos(block.open.from, 1),
      to: changes.mapPos(block.open.to, -1),
    },
    close: {
      from: changes.mapPos(block.close.from, 1),
      to: changes.mapPos(block.close.to, -1),
    },
  };
}

/// リビール状態が**変わったゾーンだけ**を filter + add で差し替える。
/// 全再計算（全行走査 + 全ゾーン組み直し）も、全ゾーンの入れ替えも避ける
function refreshZones(
  state: EditorState,
  current: DecorationSet,
  meta: BlockWidgetMeta,
  changed: number[],
): DecorationSet {
  let set = current;
  const done = new Set<number>();
  for (const index of changed) {
    if (done.has(index)) continue;
    // ゾーンは入れ子になりうる（`<details>` の囲みの中の `:::note`、閉じた数式の中の
    // `:::note` など）。1 つのゾーンの範囲を消すと中のゾーンの装飾も消えるので、
    // 重なるゾーンをまとめて消して全部足し直す（再レビュー 2026-09-25 / 21-12。
    // 以前は外側だけ足し直し、中の囲みの帯が消えていた）
    let from = meta.zones[index].from;
    let to = meta.zones[index].to;
    const cluster = new Set<number>([index]);
    for (let grew = true; grew;) {
      grew = false;
      meta.zones.forEach((zone, other) => {
        if (cluster.has(other) || zone.to < from || zone.from > to) return;
        cluster.add(other);
        from = Math.min(from, zone.from);
        to = Math.max(to, zone.to);
        grew = true;
      });
    }
    const add: Range<Decoration>[] = [];
    // 作り直しと同じ順（ゾーンは囲み → 折りたたみ → 数式・図の順に並んでいる）で
    // 足す。同じ位置の行の装飾は足した順に並ぶ
    for (const member of [...cluster].sort((a, b) => a - b)) {
      done.add(member);
      add.push(
        ...zoneDecorations(state, meta.zones[member], meta.notes, meta.details),
      );
    }
    set = set.update({
      filterFrom: from,
      filterTo: to,
      filter: () => false,
      add,
      sort: true,
    });
  }
  blockWidgetMeta.set(set, meta);
  return set;
}

/// リビール鍵（"1,4" 形式）の新旧差分 = 状態が変わったゾーンの添字。
function changedZones(before: string, after: string): number[] {
  const parse = (key: string) => new Set(key ? key.split(",").map(Number) : []);
  const a = parse(before);
  const b = parse(after);
  const out: number[] = [];
  for (const i of a) if (!b.has(i)) out.push(i);
  for (const i of b) if (!a.has(i)) out.push(i);
  return out;
}

/// 数式ブロック・図・:::note の囲み。表（tableField）と同じ間引き:
/// ゾーンに関わらない編集は位置写像だけ、カーソル移動はリビール鍵が
/// 変わったときだけ、解析の進みは「届いた位置が伸びたとき」だけ数え直す。
export const blockWidgetField = StateField.define<DecorationSet>({
  create: computeBlockWidgetSet,
  update(value, tr) {
    const modeChanged = revealModeSwitched(tr);
    const themeChanged = tr.effects.some((e) => e.is(setDiagramTheme));
    // 言語設定の差し替え（indentedCode）は木ごと変わる（21-5）
    if (modeChanged || themeChanged || tr.reconfigured) {
      return computeBlockWidgetSet(tr.state);
    }
    const meta = blockWidgetMeta.get(value);
    if (!meta) return computeBlockWidgetSet(tr.state);

    const parsed = syntaxTree(tr.state).length;
    if (tr.docChanged) {
      if (editNearBlockWidgets(tr) || editTouchesHtmlBlock(tr)) {
        return computeBlockWidgetSet(tr.state);
      }
      const parsedTo = tr.changes.mapPos(meta.parsedTo, 1);
      if (parsed > parsedTo) return computeBlockWidgetSet(tr.state);
      const zones = meta.zones.map((zone) => ({
        from: tr.changes.mapPos(zone.from, 1),
        to: tr.changes.mapPos(zone.to, -1),
      }));
      const notes = meta.notes.map((note) => mapContainer(note, tr.changes));
      const details = meta.details.map((entry) =>
        mapContainer(entry, tr.changes),
      );
      const revealKey = revealKeyOf(tr.state, zones);
      const mapped = value.map(tr.changes);
      // キャレットが外にあるままブロックの**中**が書き換わる経路（すべて置換・
      // 色付け・replaceRange）では記号が近くに無く、widget が古いまま残った
      // （レビュー 2026-09-24 / 21-3）。触れたゾーンも差し替える
      const indices = new Set<number>();
      meta.zones.forEach((zone, index) => {
        if (tr.changes.touchesRange(zone.from, zone.to)) indices.add(index);
      });
      if (revealKey !== meta.revealKey) {
        for (const index of changedZones(meta.revealKey, revealKey))
          indices.add(index);
      }
      if (indices.size > 0) {
        return refreshZones(
          tr.state,
          mapped,
          { zones, notes, details, revealKey, parsedTo },
          [...indices],
        );
      }
      blockWidgetMeta.set(mapped, {
        zones,
        notes,
        details,
        revealKey,
        parsedTo,
      });
      return mapped;
    }
    if (parsed > meta.parsedTo) return computeBlockWidgetSet(tr.state); // 解析が進んだ
    if (!tr.selection) return value;
    // カーソル移動のみ: リビール状態が変わったゾーンだけ差し替える
    //（全再計算に落とすと、300 打鍵ベンチで p95 が基準すれすれになる）
    const revealKey = revealKeyOf(tr.state, meta.zones);
    if (revealKey !== meta.revealKey) {
      return refreshZones(
        tr.state,
        value,
        { ...meta, revealKey },
        changedZones(meta.revealKey, revealKey),
      );
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const tableField = StateField.define<DecorationSet>({
  create: computeTableSet,
  update(value, tr) {
    const modeChanged = revealModeSwitched(tr);
    if (modeChanged || tr.reconfigured) return computeTableSet(tr.state);
    const meta = tableMeta.get(value);
    if (!meta) return computeTableSet(tr.state);

    // **解析が「先へ」進んだら数え直す。** 長いノートは開いた時点では
    // 途中までしか解析されておらず、下のほうの表はまだ木に無い（実機で
    // 発覚 2026-09-04）。判定は「届いた位置が伸びたか」で行う — 木の
    // オブジェクト同一性で見ると、打鍵のたびに全再計算になって打鍵
    // p95 が 16ms を割る（レビュー 2026-09-04 で実測）
    const parsed = syntaxTree(tr.state).length;

    if (tr.docChanged) {
      const parsedTo = tr.changes.mapPos(meta.parsedTo, 1);
      if (parsed > parsedTo) return computeTableSet(tr.state);
      // 既にある表の中だけの編集（行の増減なし）なら、その表だけ差し替える。
      // `|` が表の外に現れた・行が増減した編集は表の生成・分割かもしれないので
      // 全部数え直す
      if (editTouchesHtmlBlock(tr)) return computeTableSet(tr.state);
      const inside = zonesTouchedInside(meta.zones, tr);
      if (
        inside === null &&
        (editNearTables(tr) || editBesideTable(meta.zones, tr))
      )
        return computeTableSet(tr.state);
      // 表の中で打った字がフェンスや HTML ブロックを開くと、その下の**別の表**が
      // 飲まれる。触ったゾーンの範囲しか見ない差し替えでは拾えないので数え直す
      if (inside !== null && editOpensBlock(tr))
        return computeTableSet(tr.state);
      const zones = meta.zones.map((zone) => ({
        from: tr.changes.mapPos(zone.from, 1),
        to: tr.changes.mapPos(zone.to, -1),
      }));
      const revealKey = revealKeyOf(tr.state, zones);
      const mapped = value.map(tr.changes);
      const indices = new Set(inside ?? []);
      if (revealKey !== meta.revealKey) {
        for (const index of changedZones(meta.revealKey, revealKey))
          indices.add(index);
      }
      if (indices.size === 0) {
        tableMeta.set(mapped, { zones, revealKey, parsedTo });
        return mapped;
      }
      return refreshTableZones(
        tr.state,
        mapped,
        { zones, revealKey, parsedTo },
        [...indices],
      );
    }
    if (parsed > meta.parsedTo) return computeTableSet(tr.state); // 解析が進んだ
    if (!tr.selection) return value;
    // カーソル移動のみ: リビール状態が変わった表だけ差し替える
    const revealKey = revealKeyOf(tr.state, meta.zones);
    if (revealKey !== meta.revealKey) {
      return refreshTableZones(
        tr.state,
        value,
        { ...meta, revealKey },
        changedZones(meta.revealKey, revealKey),
      );
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
