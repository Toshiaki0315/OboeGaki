// 書き取りの窓の土台（ADR-0057）。保管フォルダは主窓と同じ localStorage から
// 読む（同じアプリの窓は同じ origin）。送ったら閉じる。

import { useState } from "react";
import {
  appendDaily,
  closeCurrentWindow as closeSelf,
  confirmDialog,
} from "../lib/ipc";
import { VAULT_KEY } from "../lib/last-vault";
import { APP_NAME } from "../lib/app-name";
import { CaptureWindow } from "./CaptureWindow";

export function CaptureRoot() {
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const root = (() => {
    try {
      return localStorage.getItem(VAULT_KEY);
    } catch {
      return null;
    }
  })();
  if (!root) {
    return (
      <div className="capture-window">
        <p className="capture-hint">
          保管フォルダがまだ開かれていません。先におぼえがき本体で開いてください。
        </p>
      </div>
    );
  }
  return (
    <>
      <CaptureWindow
        disabled={sending}
        onSubmit={(text) => {
          // 書き込みが遅いとき（iCloud 上の vault など）に ⌘+Enter を 2 回押すと
          // 同じ文が 2 回足された（レビュー 2026-09-24 / 21-3）。送っている間は受けない
          if (sending) return;
          setSending(true);
          appendDaily(root, text).then(
            () =>
              // 足せたのに窓が閉じられないときは、再送を受けない（もう一度
              // 送ると二重に足す。21-5）
              closeSelf().catch((error) =>
                setStatus(`閉じられませんでした: ${String(error)}`),
              ),
            (error) => {
              setSending(false);
              setStatus(`書けませんでした: ${String(error)}`);
            },
          );
        }}
        onCancel={(text) => {
          // 送り終えて閉じられなかっただけの状態では「捨てますか」と聞かない（21-7）
          if (!text.trim() || sending) {
            void closeSelf().catch((error) =>
              setStatus(`閉じられませんでした: ${String(error)}`),
            );
            return;
          }
          confirmDialog("書いたものを捨てますか？", {
            title: APP_NAME,
            kind: "warning",
          })
            .then((ok) => {
              if (ok) return closeSelf();
            })
            .catch(() => {});
        }}
      />
      {status && <p className="capture-hint capture-error">{status}</p>}
    </>
  );
}
