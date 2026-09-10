// 起動時（vault を開いた直後）にどのノートを開くか。
//
// - 前回開いていたノートが残っていればそれ（要望 2026-09-08）
// - 無ければ一番上（要望 2026-09-04）。前回の覚えは捨てる
// - 一覧が空なら**索引の同期が済むまで待つ**。開いた直後の一覧は索引から
//   引くので、索引が無い・古い vault（T7: 捨ててよいキャッシュ）では中身が
//   あっても空に見える。育つ前に「空」と決めると、ノートがあるのに無題を作る
// - 同期が済んでも空なら「無題」を作る（要望 2026-09-10。何も無い画面より
//   書き始められる方が親切）

export type StartupAction =
  | { kind: "open"; path: string; forget: boolean }
  | { kind: "create" }
  | { kind: "wait" };

export function startupAction(input: {
  remembered: string | null;
  notes: readonly { path: string }[];
  sorted: readonly { path: string }[];
  indexSynced: boolean;
}): StartupAction {
  const { remembered, notes, sorted, indexSynced } = input;
  if (notes.length === 0)
    return indexSynced ? { kind: "create" } : { kind: "wait" };
  if (remembered && notes.some((entry) => entry.path === remembered)) {
    return { kind: "open", path: remembered, forget: false };
  }
  const first = sorted[0]?.path ?? notes[0].path;
  return { kind: "open", path: first, forget: remembered !== null };
}
