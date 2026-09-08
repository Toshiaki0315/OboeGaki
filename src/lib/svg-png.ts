// SVG（Mermaid の図）を PNG にする。PowerPoint には SVG をそのまま置けない
// ので、WebView の canvas で描いて PNG の data URL にする（ADR-0037 の図は
// 画面でも SVG → 描画なので、同じ経路）。大きさの読み取りと root への
// 幅・高さの付け方は純関数にして、描く部分だけを DOM に頼る。

const DEFAULT_SIZE = { width: 800, height: 600 };

/// 図の大きさ（px）。Mermaid の出力は width が "100%" のことがあるので、
/// **viewBox を先に見る**。読めなければ既定
export function svgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(
    /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/,
  );
  if (viewBox) {
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    if (width > 0 && height > 0) return { width, height };
  }
  const width = Number(svg.match(/<svg[^>]*\swidth="([\d.]+)(?:px)?"/)?.[1]);
  const height = Number(svg.match(/<svg[^>]*\sheight="([\d.]+)(?:px)?"/)?.[1]);
  if (width > 0 && height > 0) return { width, height };
  return DEFAULT_SIZE;
}

/// root に明示的な幅と高さ（px）を付ける。**無いと `<img>` が 300×150 で
/// 描かれる**（100% は絵の外では意味を持たない）。scale で解像度を上げる
export function sizedSvg(svg: string, scale = 1): string {
  const { width, height } = svgSize(svg);
  const stripped = svg.replace(
    /<svg([^>]*?)>/,
    (_, attrs: string) =>
      `<svg width="${Math.round(width * scale)}" height="${Math.round(height * scale)}"${attrs
        .replace(/\s(width|height)="[^"]*"/g, "")
        .replace(/\s*$/, "")}>`,
  );
  return stripped;
}

/// SVG を PNG の data URL にする。描けなければ null（呼び出し側がコードの
/// まま残す）。**WebView でしか動かない**（canvas と Image が要る）。
export function svgToPng(svg: string, scale = 2): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const { width, height } = svgSize(svg);
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          const context = canvas.getContext("2d");
          if (!context) return resolve(null);
          // 図の地は透明のことが多い。紙（白）に置くので白で塗る
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        sizedSvg(svg, scale),
      )}`;
    } catch {
      resolve(null);
    }
  });
}
