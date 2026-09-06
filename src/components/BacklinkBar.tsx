// バックリンク（E-6）。このノートを指しているノートを本文の下に畳んで出す。

import type { Backlink } from "../stores/app";

export function BacklinkBar({
  backlinks,
  onOpen,
}: {
  backlinks: readonly Backlink[];
  /// 押されたノートの、保管フォルダからの相対パス
  onOpen: (path: string) => void;
}) {
  return (
    <details className="backlink-bar">
      <summary>バックリンク（{backlinks.length}）</summary>
      <ul>
        {backlinks.map((entry) => (
          <li key={entry.path}>
            <button onClick={() => onOpen(entry.path)}>
              <span className="backlink-title">
                {entry.title}
                {/* 続柄（M-3）。付いているものだけ出す */}
                {entry.relation && (
                  <span className="backlink-relation">{entry.relation}</span>
                )}
              </span>
              <span className="backlink-context">{entry.context}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
