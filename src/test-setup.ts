// vitest の共通の後始末。jsdom のテストだけ、描いたものを毎回片付ける
// （以前は 36 ファイルが各自 `afterEach(cleanup)` を書いていた。19-1。2026-09-18）。
// node 環境のテストでは document が無いので何もしない — @testing-library を
// 読み込むのも jsdom のときだけ（ADR-0048: jsdom は宣言したファイルだけ）

import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
