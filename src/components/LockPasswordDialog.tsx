// 施錠のパスワードの窓（TASKS 13-5 / ADR-0062）。
//
// - create: 保管フォルダで最初の施錠。2 回打たせ、**忘れたら読めない**ことに同意して
//   もらってから進む（決定 3。復旧の手段は無い）
// - enter: 施錠ノートはあるが解錠していない。今のパスワードを 1 回
// - change: 今のパスワードと新しいパスワード（2 回）
//
// onSubmit(新しい / 入れたパスワード, 今のパスワード（change のときだけ）)。違えば
// 理由の文字で reject する。

import { useState } from "react";
import { Dialog } from "./Dialog";

export type LockPasswordMode = "create" | "enter" | "change";

export function LockPasswordDialog({
  mode,
  title,
  onSubmit,
  onClose,
}: {
  mode: LockPasswordMode;
  /// 施錠するノートの題（change では使わない）
  title: string;
  onSubmit: (password: string, current: string) => Promise<void>;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choosing = mode !== "enter"; // 新しいパスワードを決める
  const mismatch = choosing && again !== "" && again !== password;
  const ready =
    password !== "" &&
    (mode !== "change" || current !== "") &&
    (!choosing || (again === password && understood));

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password, mode === "change" ? current : "");
    } catch (reason) {
      setError(String(reason));
      // 打ち直してもらう（違っていたのが今のパスワードなら今の欄を、そうでなければ入れた欄を）
      if (mode === "change") setCurrent("");
      else setPassword("");
      setBusy(false);
    }
  }

  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <label>
      <span>{label}</span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          // 変換を確定する Enter では送らない（T5）
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void submit();
        }}
      />
    </label>
  );

  return (
    <Dialog
      title={mode === "change" ? "施錠のパスワードを変える" : "ノートを施錠"}
      className="unlock-palette"
      onClose={busy ? undefined : onClose}
    >
      <div className="unlock-body">
        {mode !== "change" && (
          <p>{`「${title}」を施錠します。中身はパスワードで暗号化され、検索・プレビュー・版の履歴・やること一覧からは外れます。`}</p>
        )}
        {mode === "change" && field("今のパスワード", current, setCurrent)}
        {field(
          mode === "change" ? "新しいパスワード" : "パスワード",
          password,
          setPassword,
        )}
        {choosing && field("もう一度", again, setAgain)}
        {mismatch && <p className="unlock-error">2 回目が違います</p>}
        {choosing && (
          <>
            <p className="pref-note">
              {
                "パスワードは保管フォルダの施錠したノート全部で共通です。忘れると、施錠したノートは読めなくなります（取り戻す手段はありません）。"
              }
            </p>
            <label className="pref-check">
              <input
                type="checkbox"
                checked={understood}
                onChange={(event) => setUnderstood(event.currentTarget.checked)}
              />
              忘れたら読めないことを分かりました
            </label>
          </>
        )}
        {error && (
          <p className="unlock-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="pref-actions">
        <span className="pref-actions-right">
          <button onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button
            className="primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {mode === "change" ? "変える" : "施錠する"}
          </button>
        </span>
      </div>
    </Dialog>
  );
}
