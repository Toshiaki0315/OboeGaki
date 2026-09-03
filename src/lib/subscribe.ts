/// 非同期に張るリスナー（Tauri の `listen`）を、畳み忘れないように包む。
///
/// `listen` は「解除する関数」を Promise で返す。素直に
/// `unlisten.then((stop) => stop())` と書くと、**登録が終わる前に畳まれた
/// ときに解除が走らない**。StrictMode は effect を張って即座に畳むので、
/// これは開発中に必ず起きる。取りこぼすとリスナーが二重に生き、メニューの
/// 操作が 2 回走る（= トグルが往復して何も起きなく見える）。

export function safeSubscribe(register: () => Promise<() => void>): () => void {
  let stop: (() => void) | undefined;
  let cancelled = false;
  register().then(
    (fn) => {
      if (cancelled) fn();
      else stop = fn;
    },
    () => {
      // 張れなかった。畳むものも無い
    },
  );
  return () => {
    cancelled = true;
    stop?.();
    stop = undefined;
  };
}
