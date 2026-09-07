// アシスタント（Ollama）の状態と処理（ADR-0049）。要約 / レビュー（L-1）・
// 質問（L-2 / ADR-0025）・関連（L-3）・止める・降ろす。Rust への包みは
// lib/ipc で、ここは判断と状態だけを持つ。**本文は手（noteText）で受け取り、
// EditorView は持たない**（T2）。

import { useEffect, useRef, useState } from "react";
import {
  appendChunk,
  llmErrorText,
  loadingNotice,
} from "../lib/assistant-text";
import {
  llmAvailable,
  llmGenerate,
  llmLoaded,
  llmStop,
  llmUnload,
  noteRelated,
  readNote,
  searchNotes,
  subscribeLlm,
  type LlmSettings,
  type RelatedNote,
  type SearchHit,
} from "../lib/ipc";
import { terms } from "../lib/keywords";
import { noteStem } from "../lib/note-path";
import { packSources, pickSources } from "../lib/sources";

export type AssistantInput = {
  /// ペインが開いているか。閉じているあいだは Ollama に触らない
  open: boolean;
  vaultRoot: string | null;
  currentPath: string | null;
  /// 一覧。索引が更新されたら関連を引き直すために、同一性だけ見る
  notes: unknown;
  settings: LlmSettings & { assistantEnabled: boolean };
  /// 打ちかけを書き切る（読ませる前に呼ぶ）
  flushEdits: () => Promise<void>;
  /// 開いているノートの本文
  noteText: () => string;
  /// ステータスバーへの知らせ
  onStatus: (text: string) => void;
};

export function useAssistant({
  open,
  vaultRoot,
  currentPath,
  notes,
  settings,
  flushEdits,
  noteText,
  onStatus,
}: AssistantInput) {
  // 一度だけ登録する購読が読む値は ref 経由
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  // 関連するノート（L-3）。**モデルは通さない**ので、Ollama が無くても出る
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [relatedShown, setRelatedShown] = useState(false);
  // vault 全体への質問（L-2）と、そのとき渡した材料
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<SearchHit[]>([]);

  // 開いているノートが変わったら引き直す（索引が更新されたときも）
  useEffect(() => {
    if (!open || !vaultRoot || !currentPath || !relatedShown) {
      // 空→空の更新で描き直さない（入力の同一性に頼らない）
      setRelated((current) => (current.length === 0 ? current : []));
      return;
    }
    let alive = true;
    void noteRelated(vaultRoot, currentPath, noteStem(currentPath))
      .then((found) => {
        if (alive) setRelated(found);
      })
      .catch(() => {
        if (alive) setRelated([]);
      });
    return () => {
      alive = false;
    };
  }, [open, vaultRoot, currentPath, notes, relatedShown]);

  // 別のノートに移ったら畳む（前のノートの関連が残っていると読み違える）
  useEffect(() => {
    setRelatedShown(false);
    setSources((current) => (current.length === 0 ? current : []));
  }, [currentPath]);

  // 開いたときだけ動いているか確かめる（**押してから断らない**）
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void llmAvailable(settings.llmPort)
      .then((found) => {
        if (alive) setLlmReady(found);
      })
      .catch(() => {
        if (alive) setLlmReady(false);
      });
    return () => {
      alive = false;
    };
  }, [open, settings.llmPort]);

  // 流れてきたぶんから順に出す（最初の 1 文字まで数秒あり、黙って待たせない）
  useEffect(
    () =>
      subscribeLlm({
        onChunk: (piece) => setAnswer((current) => appendChunk(current, piece)),
        onDone: () => setThinking(false),
        onFailed: (reason) => {
          setThinking(false);
          setAnswer(
            llmErrorText(
              reason,
              settingsRef.current.llmTimeoutMinutes,
              settingsRef.current.llmModel,
            ),
          );
        },
      }),
    [],
  );

  /// 押すたびに画面を空にする（要望 2026-09-04）。**前の答えを残さない** —
  /// 残っていると、新しい問いの答えが出るまでのあいだ、前の答えを新しい
  /// ものと読み違える。
  function clear() {
    setAnswer("");
    setSources([]);
    setRelatedShown(false);
  }

  /// 走っている生成を止める（L-1）。**受け取ったぶんは消さない。**
  function stop() {
    void llmStop();
  }

  /// 関連するノートを出す（L-3）。**モデルを通さない** — 関係の根拠は
  /// 索引の中にある（同じタグ・`[[…]]` の指し合い・題名の言及）。
  function showRelated() {
    clear();
    setRelatedShown(true);
  }

  /// vault 全体に質問する（L-2 / ADR-0025）。
  ///
  /// **材料はこちらが選ぶ。** 索引で候補を引き、その本文を渡す。渡した
  /// ノートを画面に出せるのはこちら側だけなので、出典を作文させない。
  async function askQuestion() {
    const asked = question.trim();
    if (!vaultRoot || !asked || thinking) return;
    clear();
    // **質問をそのまま探さない。** 全文検索は打った通りの並びを探すので、
    // 「予算について何が決まった？」ではどこにも当たらない（lib/keywords）
    const words = terms(asked);
    const hits: SearchHit[] = [];
    for (const word of words.length > 0 ? words : [asked]) {
      try {
        const outcome = await searchNotes(vaultRoot, word);
        hits.push(...outcome.hits);
      } catch {
        // 1 語探せなくても、残りの語で続ける
      }
    }
    const picked = pickSources(hits);
    if (picked.length === 0) {
      // 材料の無い問いに答えさせない（作り話が出る）
      setAnswer(
        "材料になるノートが見つかりませんでした。言葉を変えて試してください。",
      );
      return;
    }
    // **出典は答えより先に出す。** 待っている間、何を見ているのか分かる
    setSources(picked);
    const bodies = await Promise.all(
      picked.map((hit) =>
        readNote(vaultRoot, `${vaultRoot}/${hit.path}`).catch(() => ""),
      ),
    );
    const packed = packSources(
      picked.map((hit, index) => ({ title: hit.title, body: bodies[index] })),
    );
    setThinking(true);
    const started = await llmGenerate(settings, {
      task: "question",
      title: "",
      body: "",
      question: asked,
      sources: packed,
    });
    if (!started) {
      setThinking(false);
      setAnswer("いま考えています。終わるまでお待ちください。");
    }
  }

  /// ノートを読ませる（要約・レビュー）。**本文は書き換えない**
  /// （答えは横に出すだけ）。
  async function ask(task: string) {
    if (!vaultRoot || !currentPath) return;
    await flushEdits(); // 打ちかけを書き切ってから読ませる
    const text = noteText();
    clear();
    setThinking(true);
    const started = await llmGenerate(settings, {
      task,
      title: noteStem(currentPath),
      body: text,
    });
    if (!started) {
      setThinking(false);
      setAnswer("いま考えています。終わるまでお待ちください。");
      return;
    }
    // 載っていなければ読み込みから（6 分の沈黙は壊れて見える）。
    // **先に届いた断りや答えを上書きしない**（loadingNotice が判断する）—
    // モデル名の間違いの 404 は、この確認より速く返ることがある
    const loaded = await llmLoaded(settings.llmPort, settings.llmModel);
    if (!loaded) setAnswer(loadingNotice);
  }

  /// モデルを降ろす（メニュー）。使わない設定なら触りに行かない
  async function unloadModel() {
    if (!settings.assistantEnabled) {
      onStatus("アシスタントは環境設定で切ってあります");
      return;
    }
    const done = await llmUnload(settings.llmPort, settings.llmModel);
    onStatus(
      done
        ? "モデルを降ろしました"
        : "いま考えています（終わってから降ろせます）",
    );
  }

  return {
    llmReady,
    answer,
    thinking,
    related,
    relatedShown,
    question,
    setQuestion,
    sources,
    stop,
    showRelated,
    ask,
    askQuestion,
    unloadModel,
  };
}
