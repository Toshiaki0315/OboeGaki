// アシスタントのペイン（Cmd+6、ADR-0025）。並びは参照実装（ui/assistant_pane.py）
// と同じ。Ollama とのやり取り・答えの組み立ては App が持ち、ここは
// **押せる・押せない**と表示だけを引き受ける。

import { useMemo } from "react";
import type { AssistantAction } from "../lib/assistant-actions";
import { imeEnterGuard } from "../lib/ime";
import { ASK_ACTION, ASSISTANT_ACTIONS } from "../lib/assistant-actions";
import type { RelatedNote, SearchHit } from "../stores/app";
import { PathIcon } from "./MenuIcon";

export type AssistantPaneProps = {
  hasNote: boolean;
  /// null は調べている途中。false なら Ollama が動いていない
  llmReady: boolean | null;
  thinking: boolean;
  answer: string;
  question: string;
  onQuestionChange: (question: string) => void;
  /// 質問に渡した材料（**そのまま出す**。出典を作文させない）
  sources: readonly SearchHit[];
  related: readonly RelatedNote[];
  relatedShown: boolean;
  onStop: () => void;
  onRelated: () => void;
  onAsk: (task: Exclude<AssistantAction["id"], "related" | "stop">) => void;
  onAskQuestion: () => void;
  /// 保管フォルダからの相対パス
  onOpen: (path: string) => void;
};

export function AssistantPane({
  hasNote,
  llmReady,
  thinking,
  answer,
  question,
  onQuestionChange,
  sources,
  related,
  relatedShown,
  onStop,
  onRelated,
  onAsk,
  onAskQuestion,
  onOpen,
}: AssistantPaneProps) {
  // 質問欄の Enter。変換中の確定と見分ける（T5、lib/ime）
  const ime = useMemo(imeEnterGuard, []);
  return (
    <aside className="assistant-pane">
      <header>アシスタント</header>
      {/* **ボタンの列は Ollama が無くても出す** — 「関連」は索引を引くだけで、
        モデルを通さない（L-3） */}
      <div className="assistant-actions" role="group" aria-label="アシスタント">
        {ASSISTANT_ACTIONS.map((action) => (
          <button
            key={action.id}
            className={action.id === "stop" ? "assistant-stop" : ""}
            title={action.hint}
            aria-label={action.label}
            disabled={
              action.id === "stop"
                ? !thinking
                : action.id === "related"
                  ? // **索引を引くだけ。** Ollama が無くても押せる（L-3）
                    !hasNote
                  : thinking || !hasNote || llmReady === false
            }
            onClick={() => {
              if (action.id === "stop") onStop();
              else if (action.id === "related") onRelated();
              else onAsk(action.id);
            }}
          >
            <PathIcon paths={action.paths} />
          </button>
        ))}
      </div>
      {llmReady === false ? (
        // **押してから断らない**（G-3 のゴミ箱と同じ作法）
        <p className="assistant-note">
          アシスタントを使うには Ollama という無料のソフトが要ります。
          <br />
          ollama.com から入れて動かすと、ここで使えるようになります。
          <br />
          読ませたノートはこのパソコンの中だけで扱われ、外へは出ません。
        </p>
      ) : (
        <>
          {/* vault 全体への質問（L-2）。打って Enter が自然（検索欄と同じ） */}
          <div className="assistant-ask">
            <input
              value={question}
              placeholder="ノート全体に質問する"
              onChange={(event) => onQuestionChange(event.currentTarget.value)}
              onCompositionEnd={(event) =>
                ime.onCompositionEnd(event.nativeEvent)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !ime.isImeEnter(event.nativeEvent))
                  onAskQuestion();
              }}
            />
            {/* 空の質問では押せない（押しても何も起きないボタンを押させない） */}
            <button
              title={ASK_ACTION.hint}
              aria-label={ASK_ACTION.label}
              disabled={thinking || !question.trim()}
              onClick={onAskQuestion}
            >
              <PathIcon paths={ASK_ACTION.paths} />
            </button>
          </div>
          {/* **答えを書き始めたら畳む**（要望 2026-09-04）。使い方の案内は、
            まだ何も出ていないときにだけ意味がある */}
          {!thinking && !answer && (
            <p className="assistant-note">
              要約とレビューはこのノートだけを読みます。質問は索引で
              材料を探して読ませます。 本文は書き換えません。
            </p>
          )}
          {sources.length > 0 && (
            <div className="related-notes">
              <div className="related-title">読んだノート</div>
              <ul>
                {sources.map((hit) => (
                  <li key={hit.path}>
                    <button onClick={() => onOpen(hit.path)}>
                      <span className="related-name">{hit.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="assistant-answer">
            {answer || (thinking ? "考えています…" : "")}
          </div>
        </>
      )}
      {/* 関連は索引から出す。**Ollama が無くても出る**（L-3） */}
      {relatedShown && (
        <div className="related-notes">
          <div className="related-title">関連するノート</div>
          <ul>
            {related.map((entry) => (
              <li key={entry.path}>
                <button onClick={() => onOpen(entry.path)}>
                  <span className="related-name">{entry.title}</span>
                  {/* **理由をそのまま出す**（読めないと確かめようがない） */}
                  <span className="related-reason">
                    {entry.reasons.join(" / ")}
                  </span>
                </button>
              </li>
            ))}
            {related.length === 0 && (
              <li className="no-hits">
                関連するノートはありません。タグを付けるか `[[ノート名]]`
                で結ぶと出ます。
              </li>
            )}
          </ul>
        </div>
      )}
    </aside>
  );
}
