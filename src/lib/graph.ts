// リンクの図（TASKS 4-9 / M-2 = 仮身ネットワーク）。
//
// BTRON の「あるファイルを起点としたリンク構造」を写したもの。
// **ここは描き方を知らない**（点と線を作るだけ）。
//
// **絞らないと開けない。** 参照実装は素朴な力学モデルで 200 点 359ms・
// 1,000 点 9.2 秒を実測しており、5,000 ノートの vault を丸ごと描く道は
// 無い。**起点からの深さで絞る**（絞り方は記事のほうが持っていた）。
//
// 描くのは Mermaid（ADR-0037 で既に積んである）に任せる。配置は向こうの
// 仕事で、こちらは**何を出すか**だけを決める。

export type Link = { from: string; to: string; relation: string };

export type GraphNode = {
  title: string;
  /// 索引にあるか。無いもの（`[[まだ無いノート]]`）は中抜きで描く。
  exists: boolean;
  /// 起点からの距離。起点は 0。
  depth: number;
};

export type Graph = {
  nodes: GraphNode[];
  /// 向きは残す（誰が誰を指しているかが読めなくなる）。
  edges: Link[];
  /// 上限で落とした点の数。**黙って減らさない**ために持つ。
  dropped: number;
};

/// 描く点の上限。
export const MAX_NODES = 60;
/// 既定の深さ。1 だと隣しか見えず、3 だと一気に増える。
export const DEFAULT_DEPTH = 2;

/// 起点から `depth` 段だけ辿った図を作る。
export function buildGraph(
  start: string,
  links: Link[],
  options: { depth?: number; maxNodes?: number; known?: string[] } = {},
): Graph {
  const depth = options.depth ?? DEFAULT_DEPTH;
  const limit = options.maxNodes ?? MAX_NODES;
  // links.target は Rust 側で NFC + 空白畳み込み済み。known（一覧の題名 =
  // ファイル名）は NFD で来ることがあるので、同じ形に寄せて突き合わせる
  //（レビュー 2026-09-04）
  const key = (title: string) =>
    title.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const known = new Set((options.known ?? []).map(key));
  const seen = new Map<string, GraphNode>();
  const droppedTitles = new Set<string>();
  const edges: Link[] = [];

  const add = (title: string, level: number): boolean => {
    const found = key(title);
    if (seen.has(found)) return true;
    if (seen.size >= limit) {
      // 同じ題名を二重に数えない（「N 件を省いています」を過大にしない）
      droppedTitles.add(found);
      return false;
    }
    seen.set(found, {
      title,
      // known が空 = 索引がまだ用意できていない。分からないときに全点を
      // 「まだ無い」で描くのは嘘なので、実在扱いに倒す
      exists: known.size === 0 ? true : known.has(found),
      depth: level,
    });
    return true;
  };

  add(start, 0);
  let frontier = [start];
  for (let level = 1; level <= depth; level++) {
    const next: string[] = [];
    for (const title of frontier) {
      // **両向きに辿る**（指している先も、指してくる元も繋がりの一部）
      for (const link of links) {
        const touches =
          key(link.from) === key(title) || key(link.to) === key(title);
        if (!touches) continue;
        const other = key(link.from) === key(title) ? link.to : link.from;
        if (!seen.has(key(other))) {
          if (add(other, level)) next.push(other);
        }
        if (!edges.some((kept) => sameEdge(kept, link))) edges.push(link);
      }
    }
    frontier = next;
  }
  // 落とした点に繋がる線は出さない（行き先の無い矢印を描かない）
  const kept = edges.filter(
    (edge) => seen.has(key(edge.from)) && seen.has(key(edge.to)),
  );
  return {
    nodes: [...seen.values()],
    edges: kept,
    dropped: droppedTitles.size,
  };
}

function sameEdge(one: Link, other: Link): boolean {
  return (
    one.from === other.from &&
    one.to === other.to &&
    one.relation === other.relation
  );
}

/// 図を Mermaid の文にする。配置は Mermaid に任せる。
export function graphToMermaid(graph: Graph, starts: string[]): string {
  const ids = new Map<string, string>();
  graph.nodes.forEach((node, index) =>
    ids.set(node.title.toLowerCase(), `n${index}`),
  );
  const lines = ["graph LR"];
  for (const node of graph.nodes) {
    const id = ids.get(node.title.toLowerCase());
    // まだ無いノートは中抜き（`([…])`）で描く
    lines.push(
      node.exists
        ? `  ${id}["${escapeLabel(node.title)}"]`
        : `  ${id}(["${escapeLabel(node.title)}"])`,
    );
  }
  for (const edge of graph.edges) {
    const from = ids.get(edge.from.toLowerCase());
    const to = ids.get(edge.to.toLowerCase());
    if (!from || !to) continue;
    lines.push(
      edge.relation
        ? `  ${from} -->|${escapeLabel(edge.relation)}| ${to}`
        : `  ${from} --> ${to}`,
    );
  }
  // 起点は目立たせる（どこから見ている図か分かるように）
  lines.push("  classDef start stroke-width:3px");
  const startIds = starts
    .map((title) => ids.get(title.toLowerCase()))
    .filter((id): id is string => Boolean(id));
  if (startIds.length > 0) {
    lines.push(`  class ${startIds.join(",")} start`);
  }
  return lines.join("\n");
}

/// 名札に入れられる形にする。**引用符と角括弧は Mermaid の構文を壊す。**
function escapeLabel(text: string): string {
  return text
    .replace(/["\[\]|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
