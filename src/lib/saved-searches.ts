// 保存した検索（TASKS 3-17 / K-4）。参照実装 config.saved_searches の移植。
//
// 検索式（3-5）に名前を付けてサイドバーに置く。置き場は他の設定と同じ
// localStorage（1-1 / 1-5 / 3-9 と揃える）。
//
// **壊れた値は空へ戻す。** 設定は手で編集できるので、読めない値で
// アプリを止めない（欠けた項目だけを捨てて、読めるものは生かす）。

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SEARCHES_KEY = "oboegaki.searches";

export type SavedSearch = {
  name: string;
  /// 検索欄に入れる式（`#タグ` / `after:` / 言葉）。
  query: string;
};

export function loadSearches(storage: StorageLike): SavedSearch[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SEARCHES_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isSearch).map((entry) => ({
    name: entry.name,
    query: entry.query,
  }));
}

function isSearch(value: unknown): value is SavedSearch {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<SavedSearch>;
  return (
    typeof entry.name === "string" &&
    entry.name.length > 0 &&
    typeof entry.query === "string" &&
    entry.query.length > 0
  );
}

export function saveSearches(
  storage: StorageLike,
  entries: SavedSearch[],
): void {
  try {
    storage.setItem(SEARCHES_KEY, JSON.stringify(entries));
  } catch {
    // 記憶できなくても今の検索は生きている
  }
}

/// 足す（**同じ名前は上書き** — 検索式の更新に使う）。
export function upsertSearch(
  entries: SavedSearch[],
  entry: SavedSearch,
): SavedSearch[] {
  return [...entries.filter((found) => found.name !== entry.name), entry];
}

export function removeSearch(
  entries: SavedSearch[],
  name: string,
): SavedSearch[] {
  return entries.filter((entry) => entry.name !== name);
}
