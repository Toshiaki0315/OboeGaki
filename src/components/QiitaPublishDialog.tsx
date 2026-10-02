// Qiita への投稿の小窓（TASKS 14-5 / ADR-0063 の決定）。
//
// 送る前に 3 つを確かめさせる: タグ（本文の `#タグ` を初期値に足し引き。決定 1）・
// 限定共有で出ること（決定 2）・載らない画像（決定 3。**黙って壊れたリンクを出さない**）。
// 送るのは親（onPublish）。失敗したら理由を出して窓は残す（直して押し直せる）。

import { useState } from "react";
import type { QiitaDraft } from "../lib/qiita";
import { Dialog } from "./Dialog";

/// Qiita のタグの数（画面側の決まり。API 文書には無い）
const MAX_TAGS = 5;

export function QiitaPublishDialog({
  draft,
  update,
  onPublish,
  onClose,
}: {
  draft: QiitaDraft;
  /// 既に投稿した記事（front matter に `qiita:` がある）を更新するか
  update: boolean;
  /// 決めたタグで送る。失敗したら理由の文字で reject する
  onPublish: (tags: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>(draft.tags.slice(0, MAX_TAGS));
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagsOk = tags.length >= 1 && tags.length <= MAX_TAGS;

  function addTag() {
    const tag = adding.trim().replace(/^#+/, "").trim();
    setAdding("");
    if (!tag || tags.length >= MAX_TAGS) return;
    // 大文字小文字だけの違いは同じタグ（Qiita も区別しない）
    if (tags.some((known) => known.toLowerCase() === tag.toLowerCase())) return;
    setTags([...tags, tag]);
  }

  async function publish() {
    if (busy || !tagsOk) return;
    setBusy(true);
    setError(null);
    try {
      await onPublish(tags);
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Qiita に投稿"
      className="qiita-palette"
      onClose={busy ? undefined : onClose}
    >
      <div className="qiita-body">
        <p className="qiita-title">{draft.title}</p>
        <p className="pref-note">
          {update
            ? "Qiita の記事を更新します（公開の状態は変えません）。"
            : "新しく限定共有で出します。読み返してから、公開は Qiita の画面で押してください。"}
        </p>
        <div className="qiita-tags">
          {tags.map((tag) => (
            <span key={tag} className="qiita-tag">
              {tag}
              <button
                aria-label={`${tag} を外す`}
                onClick={() => setTags(tags.filter((known) => known !== tag))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            aria-label="タグを足す"
            placeholder="タグを足す"
            value={adding}
            disabled={tags.length >= MAX_TAGS}
            onChange={(event) => setAdding(event.currentTarget.value)}
            onKeyDown={(event) => {
              // 変換を確定する Enter では足さない（T5）
              if (event.key !== "Enter" || event.nativeEvent.isComposing)
                return;
              event.preventDefault();
              addTag();
            }}
          />
        </div>
        {!tagsOk && (
          <p className="pref-note">タグは 1〜{MAX_TAGS} 個にしてください。</p>
        )}
        {draft.localImages.length > 0 && (
          <div className="qiita-warning" role="note">
            <p>
              {`${draft.localImages.length} 枚の画像は Qiita に載りません（リンクは切れたまま送ります。Qiita の画面で貼り直してください）:`}
            </p>
            <ul>
              {draft.localImages.map((image) => (
                <li key={image}>{image}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p className="qiita-error" role="alert">
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
            disabled={!tagsOk || busy}
            onClick={() => void publish()}
          >
            {busy
              ? "送っています…"
              : update
                ? "更新する"
                : "限定共有で投稿する"}
          </button>
        </span>
      </div>
    </Dialog>
  );
}
