// リンクの図（M-2）。Mermaid が描いた SVG を受け取って見せるだけ — 組むのは
// 親（App の showLinkGraph）。**絞らないと開けない**ので深さを 1〜4 段で
// 行き来させる。

export type GraphDialogProps = {
  svg: string;
  /// 上限で落とした件数。**黙って減らさない**
  dropped: number;
  depth: number;
  onDepth: (depth: number) => void;
  onClose: () => void;
};

export function GraphDialog({
  svg,
  dropped,
  depth,
  onDepth,
  onClose,
}: GraphDialogProps) {
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette graph-dialog"
        role="dialog"
        aria-label="リンクの図"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-title">リンクの図</header>
        <div
          className="graph-canvas"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="dialog-text">
          {dropped > 0
            ? `多いので ${dropped} 件を省いています。`
            : "開いているノートから辿れる範囲です。"}
        </p>
        <div className="conflict-actions">
          <button disabled={depth <= 1} onClick={() => onDepth(depth - 1)}>
            狭く
          </button>
          <button disabled={depth >= 4} onClick={() => onDepth(depth + 1)}>
            広く（{depth} 段）
          </button>
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
