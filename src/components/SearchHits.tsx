// 検索結果の一覧。検索欄に字があるあいだ、一覧ペインの中身がこれに変わる。

import type { SearchHit } from "../stores/app";

export function SearchHits({
  hits,
  onOpen,
}: {
  hits: readonly SearchHit[];
  /// 保管フォルダからの相対パス
  onOpen: (path: string) => void;
}) {
  return (
    <ul className="note-scroll note-rows">
      {hits.map((hit) => (
        <li key={hit.path}>
          <button className="search-hit" onClick={() => onOpen(hit.path)}>
            <span className="hit-title">{hit.title}</span>
            <span className="hit-snippet">{hit.snippet}</span>
          </button>
        </li>
      ))}
      {hits.length === 0 && <li className="no-hits">見つかりません</li>}
    </ul>
  );
}
