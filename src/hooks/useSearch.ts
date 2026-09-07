// 検索・絞り込み・並び順（ADR-0049）。検索語（C-1）・保存した検索（K-4）・
// タグ（C-4）とフォルダ（ADR-0024）の絞り込み・並び順（C-3）。
// **検索・タグ・フォルダは排他** — どれも一覧の中身を差し替える。

import { useEffect, useMemo, useRef, useState } from "react";
import { createDebouncer } from "../lib/debounce";
import { TRASH_FOLDER } from "../lib/finder";
import {
  notesInFolder,
  notesWithTag,
  searchNotes,
  type SearchHit,
} from "../lib/ipc";
import { sortNotes, type NoteEntry, type SortOrder } from "../lib/note-order";
import {
  loadSearches,
  removeSearch,
  saveSearches,
  upsertSearch,
  type SavedSearch,
} from "../lib/saved-searches";

const SORT_KEY = "oboegaki.sort";

export type SearchInput = {
  vaultRoot: string | null;
  /// 一覧（絞っていないときの中身。索引が更新されると差し替わる）
  notes: NoteEntry[];
  /// 並び順と保存した検索の置き場所
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  onStatus: (text: string) => void;
};

export function useSearch({
  vaultRoot,
  notes,
  storage,
  onStatus,
}: SearchInput) {
  const [query, setQueryState] = useState("");
  // 遅いクエリの結果が新しいクエリの結果を上書きしないための世代
  const queryRef = useRef(query);
  queryRef.current = query;
  const vaultRootRef = useRef(vaultRoot);
  vaultRootRef.current = vaultRoot;
  const [hits, setHits] = useState<SearchHit[]>([]);
  const searchSoon = useMemo(() => createDebouncer(200), []);

  // 保存した検索（K-4）。名前を付けた検索式をサイドバーに置く
  const [searches, setSearches] = useState<SavedSearch[]>(() =>
    loadSearches(storage),
  );
  function keepSearches(next: SavedSearch[]) {
    setSearches(next);
    saveSearches(storage, next);
  }
  /// 同じ名前は上書き（検索式の更新に使う）
  function rememberSearch(name: string, typed: string) {
    keepSearches(upsertSearch(searches, { name, query: typed }));
  }
  function forgetSearch(name: string) {
    keepSearches(removeSearch(searches, name));
  }

  // タグでの絞り込み（C-4）
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagNotes, setTagNotes] = useState<NoteEntry[]>([]);
  // フォルダでの絞り込み（ADR-0024）。null は絞っていない、"" は直下
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [folderNotes, setFolderNotes] = useState<NoteEntry[]>([]);

  // 一覧の並び順（C-3 相当）。選び直したら覚える
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    try {
      return storage.getItem(SORT_KEY) === "title" ? "title" : "modified";
    } catch {
      return "modified";
    }
  });
  function changeSort(order: SortOrder) {
    setSortOrder(order);
    try {
      storage.setItem(SORT_KEY, order);
    } catch {
      // 保存できなくても切り替え自体は生かす
    }
  }

  /// ゴミ箱を見ているか（一覧の中身が捨てたノートに変わる）
  const trashView = folderFilter === TRASH_FOLDER;
  const sortedNotes = useMemo(() => {
    const listed =
      folderFilter !== null ? folderNotes : tagFilter ? tagNotes : notes;
    return sortNotes(listed, sortOrder);
  }, [notes, tagNotes, tagFilter, folderNotes, folderFilter, sortOrder]);

  function setQuery(next: string) {
    setQueryState(next);
    if (next.trim()) {
      // 検索・タグ・フォルダは排他（どれも一覧の中身を差し替える）
      setTagFilter(null);
      setFolderFilter(null);
    }
    if (!next.trim()) {
      searchSoon.cancel();
      setHits([]);
      return;
    }
    searchSoon.schedule(() => {
      const root = vaultRootRef.current;
      if (!root) return;
      searchNotes(root, next)
        .then((outcome) => {
          // 世代ガード: 遅いクエリの結果が、後から打った新しいクエリの
          // 結果を上書きしない（レビュー 2026-09-04）。デバウンスは予約を
          // 絞るだけで、発射済みの invoke は絞れない
          if (queryRef.current !== next) return;
          setHits(outcome.hits);
          // 読めない日付を黙って絞りに使わない。0 件になった理由が
          // 画面から読めないと、打ち間違いに気づけない
          onStatus(
            outcome.unreadable.length > 0
              ? `日付として読めません: ${outcome.unreadable.join(" ")}（例: after:2026-09-03）`
              : "",
          );
        })
        .catch((error) => {
          if (queryRef.current !== next) return;
          onStatus(`検索に失敗: ${String(error)}`);
        });
    });
  }

  /// タグで一覧を絞る（null で解除）。検索とは排他。
  function filterByTag(tag: string | null) {
    setTagFilter(tag);
    if (tag) {
      setFolderFilter(null);
      searchSoon.cancel();
      setQueryState("");
      setHits([]);
    }
  }

  // 絞り込み中のタグのノートを引き直す。notes が変わったとき（= 索引が
  // 更新されたとき）も引き直して、絞った一覧を置き去りにしない
  useEffect(() => {
    if (!vaultRoot || !tagFilter) {
      setTagNotes((current) => (current.length === 0 ? current : []));
      return;
    }
    let alive = true;
    void notesWithTag(vaultRoot, tagFilter).then((found) => {
      if (alive) setTagNotes(found);
    });
    return () => {
      alive = false;
    };
  }, [vaultRoot, tagFilter, notes]);

  /// フォルダで一覧を絞る（null で解除）。検索・タグとは排他。
  function filterByFolder(folder: string | null) {
    setFolderFilter(folder);
    if (folder !== null) {
      searchSoon.cancel();
      setQueryState("");
      setHits([]);
      setTagFilter(null);
    }
  }

  // 絞り込み中のフォルダのノートを引き直す（notes が変わったとき =
  // 索引が更新されたときも）
  useEffect(() => {
    // **ゴミ箱は索引に無い**（T7 の走査対象外）。引きに行っても空なので、
    // trash_list から来る trashNotes をそのまま一覧に出す（App 側）
    if (!vaultRoot || folderFilter === null || folderFilter === TRASH_FOLDER) {
      setFolderNotes((current) => (current.length === 0 ? current : []));
      return;
    }
    let alive = true;
    void notesInFolder(vaultRoot, folderFilter).then((found) => {
      if (alive) setFolderNotes(found);
    });
    return () => {
      alive = false;
    };
  }, [vaultRoot, folderFilter, notes]);

  return {
    query,
    setQuery,
    hits,
    searches,
    rememberSearch,
    forgetSearch,
    tagFilter,
    filterByTag,
    folderFilter,
    filterByFolder,
    trashView,
    sortOrder,
    changeSort,
    sortedNotes,
  };
}
