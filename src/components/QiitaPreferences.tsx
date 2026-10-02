// 環境設定「Qiita」タブ（TASKS 14-1 / ADR-0063）。
//
// **トークンは Keychain に入れるだけ**で、画面には「入っているか」しか出さない
// （Rust 側にも値を返す命令が無い）。保管フォルダにも設定 JSON にも書かない —
// 保管フォルダは共有・同期されうる（ADR-0052）。

import { useEffect, useState } from "react";

/// トークンの出し入れ（IPC は親が渡す。テストで差し替えられるように）
export type QiitaTokenAccess = {
  saved: () => Promise<boolean>;
  save: (token: string) => Promise<void>;
  clear: () => Promise<void>;
};

export function QiitaPreferences({ token }: { token: QiitaTokenAccess }) {
  // null は確かめている途中
  const [saved, setSaved] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    token
      .saved()
      .then((found) => alive && setSaved(found))
      .catch(() => alive && setSaved(false));
    return () => {
      alive = false;
    };
  }, [token]);

  async function save() {
    try {
      await token.save(draft);
      // 打った値は画面に残さない
      setDraft("");
      setError(null);
      setSaved(true);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function clear() {
    try {
      await token.clear();
      setError(null);
      setSaved(false);
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <div className="pref-page">
      <h3 className="pref-section">Qiita へ投稿する</h3>
      {/* 文は文字列で書く — JSX の改行は空白になり、日本語の途中に隙間が入る */}
      <p className="pref-note">
        {"Qiita の「設定 → アプリケーション → 個人用アクセストークン」で、"}
        <code>write_qiita</code>
        {
          " にチェックを入れて発行したトークンを入れます。トークンはこの Mac のキーチェーンにだけ置き、保管フォルダや設定ファイルには書きません。"
        }
      </p>
      {saved === null ? (
        <p className="pref-note">確かめています…</p>
      ) : saved ? (
        <>
          <p>トークンは Keychain に入っています</p>
          <button onClick={() => void clear()}>トークンを消す</button>
        </>
      ) : (
        <>
          <p>トークンは入っていません</p>
          <label>
            <span>アクセストークン</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </label>
          <button disabled={!draft.trim()} onClick={() => void save()}>
            Keychain に入れる
          </button>
        </>
      )}
      {error && (
        <p className="pref-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
