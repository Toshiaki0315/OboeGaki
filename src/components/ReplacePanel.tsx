// 保管フォルダ全体の置換（ADR-0055 / 12-3）。検索欄の字を、全ノートで
// 置き換える。**押す前に件数を見せる**（元に戻せない操作なので）。正規表現は
// 使わない — 書き手の道具にしない。コードと front matter の中は既定で除く。

import { useEffect, useState } from "react";
import type { ReplaceCount, ReplaceOptions } from "../lib/ipc";

export function ReplacePanel({
  query,
  onPreview,
  onApply,
}: {
  /// 置き換える字（検索欄の字そのまま。素の文字列として扱う）
  query: string;
  onPreview: (options: ReplaceOptions) => Promise<ReplaceCount>;
  onApply: (to: string, options: ReplaceOptions) => Promise<void>;
}) {
  const [to, setTo] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeCode, setIncludeCode] = useState(false);
  const [count, setCount] = useState<ReplaceCount | null>(null);
  const [busy, setBusy] = useState(false);
  const options: ReplaceOptions = { caseSensitive, includeCode };

  useEffect(() => {
    let alive = true;
    setCount(null);
    onPreview({ caseSensitive, includeCode })
      .then((found) => {
        if (alive) setCount(found);
      })
      .catch(() => {
        if (alive) setCount({ notes: 0, occurrences: 0 });
      });
    return () => {
      alive = false;
    };
    // onPreview は毎描画で作り直されるが、数え直す条件は字と 2 つの印
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, includeCode]);

  const canApply =
    !busy && to.length > 0 && to !== query && (count?.occurrences ?? 0) > 0;
  return (
    <div className="replace-panel" role="group" aria-label="置換">
      <label className="replace-to">
        <span>置換後</span>
        <input
          aria-label="置換後"
          value={to}
          onChange={(event) => setTo(event.currentTarget.value)}
          placeholder={`「${query}」を置き換える字`}
        />
      </label>
      <div className="replace-options">
        <label>
          <input
            type="checkbox"
            aria-label="大小を区別"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.currentTarget.checked)}
          />
          大小を区別
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="コードの中も"
            checked={includeCode}
            onChange={(event) => setIncludeCode(event.currentTarget.checked)}
          />
          コードの中も
        </label>
      </div>
      <div className="replace-run">
        <span className="replace-count">
          {count === null
            ? "数えています…"
            : count.occurrences === 0
              ? "該当なし"
              : `${count.notes} 件のノート・${count.occurrences} 箇所`}
        </span>
        <button
          disabled={!canApply}
          onClick={() => {
            setBusy(true);
            void onApply(to, options).finally(() => setBusy(false));
          }}
        >
          置換する
        </button>
      </div>
    </div>
  );
}
