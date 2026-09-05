// 開発サーバのポート決定。既定は 1430。
//
// Tauri テンプレートの既定値 1420 は、同じテンプレートから作った他アプリ
// （FudaCho など）と衝突する。衝突すると Vite は strictPort で起動に失敗する
// 一方、Tauri のウィンドウは devUrl のポートを読みに行くため「別アプリの画面が
// 出る」という分かりにくい形で現れる。既定を 1430 へずらしたうえで、環境変数
// OBOEGAKI_DEV_PORT で切り替えられるようにしておく（3 つ目のアプリが来ても
// Makefile を書き換えずに逃げられる）。

/** ポートを指定する環境変数の名前 */
export const DEV_PORT_ENV = "OBOEGAKI_DEV_PORT";

/** 未指定のときのポート */
export const DEFAULT_DEV_PORT = 1430;

/** ウェルノウンポートを避ける下限 */
const MIN_PORT = 1024;
/** TCP ポートの上限 */
const MAX_PORT = 65535;

export type DevPorts = {
  /** Vite の dev サーバ（Tauri の devUrl もこれに合わせる） */
  port: number;
  /** HMR（TAURI_DEV_HOST 指定時に使う）。本体の隣を取る */
  hmrPort: number;
};

/**
 * 環境変数から dev サーバのポートを決める。
 * 誤った指定は黙って既定へ落とさず、その場で失敗させる
 * （気づかないまま別ポートで起動すると原因の切り分けが難しくなる）。
 */
export function resolveDevPort(
  env: Record<string, string | undefined>,
): DevPorts {
  const raw = env[DEV_PORT_ENV]?.trim();
  if (raw === undefined || raw === "") {
    return { port: DEFAULT_DEV_PORT, hmrPort: DEFAULT_DEV_PORT + 1 };
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${DEV_PORT_ENV} には整数を指定してください（指定値: ${raw}）`,
    );
  }
  const port = Number(raw);
  // HMR が隣を取るため、上限そのものは使えない
  if (port < MIN_PORT || port >= MAX_PORT) {
    throw new Error(
      `${DEV_PORT_ENV} は ${MIN_PORT} 以上 ${MAX_PORT - 1} 以下で指定してください（指定値: ${raw}）`,
    );
  }
  return { port, hmrPort: port + 1 };
}
