// スライドの下絵（環境設定 PowerPoint タブのプレビュー、8-6）。枠の位置と
// 量だけを描く — 読ませるためではなく、収まり具合を見せるため。

import type { Preview, PreviewPage } from "../lib/slide-preview";

export function SlidePreview({
  page,
  view,
}: {
  page: PreviewPage;
  view: Preview;
}) {
  const scale = 100 / view.widthIn; // 幅 100 の座標系に写す
  const height = view.heightIn * scale;
  return (
    <svg
      className="slide-preview"
      viewBox={`0 0 100 ${height}`}
      role="img"
      aria-label={`${page.title} のプレビュー`}
    >
      <rect x="0" y="0" width="100" height={height} className="sp-paper" />
      {page.frames.map((frame, index) => {
        const box = {
          x: frame.x * scale,
          y: frame.y * scale,
          width: frame.w * scale,
          height: Math.max(0.6, frame.h * scale),
        };
        if (frame.kind === "code" || frame.kind === "table") {
          return <rect key={index} {...box} className={`sp-${frame.kind}`} />;
        }
        if (frame.kind === "image") {
          return <rect key={index} {...box} className="sp-image" />;
        }
        if (frame.kind === "flow") {
          // 段落は線で表す（読ませるためではなく、量を見せるため）
          const lines = Math.max(1, Math.min(12, frame.blocks.length * 2));
          return (
            <g key={index}>
              {Array.from({ length: lines }, (_, line) => (
                <rect
                  key={line}
                  x={box.x}
                  y={box.y + line * 2.2}
                  width={box.width * (line % 3 === 2 ? 0.62 : 0.96)}
                  height={0.9}
                  className="sp-line"
                />
              ))}
            </g>
          );
        }
        const big = frame.kind === "cover";
        return (
          <rect
            key={index}
            {...box}
            height={big ? box.height : Math.max(1.4, box.height * 0.5)}
            className={frame.kind === "footer" ? "sp-footer" : "sp-title"}
          />
        );
      })}
    </svg>
  );
}
