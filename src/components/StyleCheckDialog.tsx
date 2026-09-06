// 文体を見る（U-4）。指摘するだけで、直しはしない — 書き換えるかどうかは
// 書いた人が決める。押すとその箇所へ飛ぶ。

import type { Finding } from "../lib/style-check";

export function StyleCheckDialog({
  findings,
  text,
  onJump,
  onClose,
}: {
  findings: readonly Finding[];
  /// 指摘の字を切り出すための本文
  text: string;
  onJump: (pos: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="文体を見る"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-title">
          文体を見る（{findings.length} 件）
        </header>
        <ul>
          {findings.map((found) => (
            <li key={`${found.start}-${found.kind}`}>
              <button onClick={() => onJump(found.start)}>
                <span className="style-text">
                  {text.slice(found.start, found.start + found.length).trim() ||
                    "（空白）"}
                </span>
                {/* **どう書けるか**を出す（何が悪いかだけでは動けない） */}
                <span className="style-message">{found.message}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="dialog-text">
          指摘するだけで、直しはしません。書き換えるかどうかは
          書いた人が決めます。
        </p>
      </div>
    </div>
  );
}
