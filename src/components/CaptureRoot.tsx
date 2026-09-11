// 書き取りの窓の土台（ADR-0057）。保管フォルダは主窓と同じ localStorage から
// 読む（同じアプリの窓は同じ origin）。送ったら閉じる。

import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { appendDaily } from "../lib/ipc";
import { VAULT_KEY } from "../lib/last-vault";
import { APP_NAME } from "../lib/app-name";
import { CaptureWindow } from "./CaptureWindow";

async function closeSelf(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export function CaptureRoot() {
  const [status, setStatus] = useState<string | null>(null);
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
        onSubmit={(text) => {
          appendDaily(root, text)
            .then(() => closeSelf())
            .catch((error) => setStatus(`書けませんでした: ${String(error)}`));
        }}
        onCancel={(text) => {
          if (!text.trim()) {
            void closeSelf();
            return;
          }
          confirm("書いたものを捨てますか？", {
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
