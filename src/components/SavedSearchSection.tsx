// 保存した検索（サイドバー）。押すと式を検索欄に流す。

import type { SavedSearch } from "../lib/saved-searches";
import { SideSection } from "./SideSection";

export function SavedSearchSection({
  searches,
  onRun,
  onRemove,
}: {
  searches: readonly SavedSearch[];
  onRun: (query: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <SideSection
      className="search-section"
      icon="search"
      label="保存した検索"
      count={searches.length}
      open
    >
      <ul>
        {searches.map((entry) => (
          <li key={entry.name}>
            <button
              className="saved-search-row"
              title={entry.query}
              onClick={() => onRun(entry.query)}
            >
              <span className="saved-search-name">{entry.name}</span>
            </button>
            <button
              className="saved-search-remove"
              title="この検索を外す"
              onClick={() => onRemove(entry.name)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </SideSection>
  );
}
