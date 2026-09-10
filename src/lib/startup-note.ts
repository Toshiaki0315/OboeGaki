// 起動時（vault を開いた直後）にどのノートを開くか。
//
// - 前回開いていたノートが残っていればそれ（要望 2026-09-08）
// - 無ければ一番上（要望 2026-09-04）。前回の覚えは捨てる
// - 一覧が空なら**ディスクを見て**決める。開いた直後の一覧は索引から引く
//   ので、索引が無い・古い vault（T7: 捨ててよいキャッシュ）では中身が
//   あっても空に見える。索引が育つのを合図（index-updated）で待つ作りは、
//   合図がリスナー登録より先に飛ぶと永遠に待った（実機 2026-09-10）
// - ディスクにも無ければ「無題」を作る（要望 2026-09-10。何も無い画面より
//   書き始められる方が親切）。あれば索引が育つのを待つ

export type StartupAction =
  | { kind: "open"; path: string; forget: boolean }
  | { kind: "ask-disk" }
  | { kind: "wait" }
  | { kind: "create" };

export function startupAction(input: {
  remembered: string | null;
  notes: readonly { path: string }[];
  sorted: readonly { path: string }[];
  /// ディスク上にノートが無いか。null = まだ聞いていない
  emptyOnDisk: boolean | null;
}): StartupAction {
  const { remembered, notes, sorted, emptyOnDisk } = input;
  if (notes.length === 0) {
    if (emptyOnDisk === null) return { kind: "ask-disk" };
    return emptyOnDisk ? { kind: "create" } : { kind: "wait" };
  }
  if (remembered && notes.some((entry) => entry.path === remembered)) {
    return { kind: "open", path: remembered, forget: false };
  }
  const first = sorted[0]?.path ?? notes[0].path;
  return { kind: "open", path: first, forget: remembered !== null };
}
