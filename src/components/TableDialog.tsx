// 表の挿入（TASKS 2-6）。行 × 列を聞いてから差し込む。打った数は欄だけが
// 持ち、読めない値や 0 以下は 2 に落とす（0 行の表を作らない）。

import { useRef } from "react";

function countOf(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
}

export function TableDialog({
  onInsert,
  onClose,
}: {
  onInsert: (rows: number, columns: number) => void;
  onClose: () => void;
}) {
  const rows = useRef<HTMLInputElement>(null);
  const columns = useRef<HTMLInputElement>(null);
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="表を挿入"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-title">表を挿入</header>
        <div className="table-dialog-fields">
          <label>
            行（見出しを除く）
            <input ref={rows} type="number" min={1} max={50} defaultValue={2} />
          </label>
          <label>
            列
            <input
              ref={columns}
              type="number"
              min={1}
              max={20}
              defaultValue={2}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>やめる</button>
          <button
            className="primary"
            onClick={() =>
              onInsert(
                countOf(rows.current?.value),
                countOf(columns.current?.value),
              )
            }
          >
            挿入
          </button>
        </div>
      </div>
    </div>
  );
}
