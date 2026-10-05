// 施錠ノートを開く前にパスワードを聞く窓（TASKS 13-3 / ADR-0062）。
// パスワードは保管フォルダに 1 つ（決定 1）。解錠は親（onUnlock）が Rust に頼む。

import { useState } from "react";
import { Dialog } from "./Dialog";

export function UnlockDialog({
  title,
  onUnlock,
  onClose,
}: {
  /// 開こうとしたノートの題
  title: string;
  /// 違えば理由の文字で reject する
  onUnlock: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(password);
    } catch (reason) {
      setError(String(reason));
      setPassword(""); // 打ち直してもらう
      setBusy(false);
    }
  }

  return (
    <Dialog title="施錠したノート" className="unlock-palette" onClose={onClose}>
      <div className="unlock-body">
        <p>{`「${title}」は施錠されています。パスワードを入れてください。`}</p>
        <label>
          <span>パスワード</span>
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            onKeyDown={(event) => {
              // 変換を確定する Enter では送らない（T5）
              if (event.key !== "Enter" || event.nativeEvent.isComposing)
                return;
              event.preventDefault();
              void unlock();
            }}
          />
        </label>
        {error && (
          <p className="unlock-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="pref-actions">
        <span className="pref-actions-right">
          <button onClick={onClose}>キャンセル</button>
          <button
            className="primary"
            disabled={!password || busy}
            onClick={() => void unlock()}
          >
            解錠
          </button>
        </span>
      </div>
    </Dialog>
  );
}
