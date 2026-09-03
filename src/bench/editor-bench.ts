// キー入力 → 画面反映の実測（spec §6.6: 95 パーセンタイル < 16ms、
// 10,000 語のノート）。実行方法は docs/bench.md。
//
// 本物の EditorView（本番と同じ拡張一式）に 1 文字ずつ挿入し、
// dispatch（同期の DOM 更新）+ 次の描画フレームまでを 1 打鍵として測る。
// Tauri API は使わないので素のブラウザでも動く。

import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "../editor/relaxed-emphasis";
import { extendedInline } from "../editor/extended-inline";
import { inputAssist } from "../editor/input-assist";
import { livePreview } from "../editor/live-preview";
import { syntaxHighlighting } from "@codemirror/language";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import { autoPair, urlPasteLink } from "../editor/auto-pair";
import { codeHighlight, resolveCodeLanguage } from "../editor/code-blocks";
import { frontMatterHide } from "../editor/frontmatter";
import { headingFolding } from "../editor/folding";
import { tableAutoFormat } from "../editor/table-format";
import { editorModes } from "../editor/modes";
import { formatKeymap } from "../editor/format-commands";
import { plainCopyKeymap } from "../editor/plain-copy";
import { attachmentEvents } from "../editor/attachments";
import { activationClicks, activationHandler } from "../editor/activation";
import { imageResolver } from "../editor/live-preview";
import { tagCompletion } from "../editor/tag-complete";
import { noteLinkCompletion } from "../editor/note-link-complete";

const KEYSTROKES = 300;
const BUDGET_MS = 16;

// 10,000 語相当のノートを組み立てる（日本語は句読点区切りを 1 語と数える）。
// 装飾の種類をまんべんなく含める（強調・リスト・引用・コード・表）
function buildDocument(): string {
  const section = `## 見出し その

これは**強調**と*斜体*と~~取り消し~~と::ハイライト::と\`コード\`を含む段落。
日本語は分かち書きしないため、ライブプレビューの装飾はインライン走査に乗る。
リンクは [説明](https://example.com/path) の形で、#タグ と [[ノートリンク]] も混ぜる。

- 箇条書きの項目をひとつ
- [ ] タスクの項目もひとつ

> 引用の行もひとつ入れておく。

| 列A | 列B |
| --- | --- |
| 値 | 値 |

\`\`\`js
const a = 1; // コード
\`\`\`

$$
E = mc^2
$$

:::note
囲みの中身もひとつ。
:::

`;
  // 参照実装の large.md（68KB・2,085 行）を上回る規模まで繰り返す
  let text = "# 性能計測ノート\n\n";
  for (let index = 0; index < 260; index++) {
    text += section.replace("その", `その${index}`);
  }
  return text;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index];
}

async function run() {
  const out = document.querySelector("#out")!;
  const doc = buildDocument();
  const words = doc.split(/[\s、。]+/).length;
  const view = new EditorView({
    parent: document.querySelector("#host")!,
    state: EditorState.create({
      doc,
      // 本番（Editor.tsx）と同じ拡張一式で測る。フェンスの入れ子パース
      // （codeLanguages）や front matter の監視が抜けた計測は嘘になる。
      // 抜いてよいのは Tauri 依存のコールバックの中身（保存・画像解決）
      // だけで、拡張そのものは空実装で載せる（レビュー 2026-09-04）
      extensions: [
        frontMatterHide,
        history(),
        autoPair,
        autocompletion({
          override: [tagCompletion(() => []), noteLinkCompletion(() => [])],
          icons: false,
        }),
        keymap.of([{ key: "Tab", run: acceptCompletion }]),
        inputAssist,
        formatKeymap,
        plainCopyKeymap,
        search({ top: true }),
        keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown({
          extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
          codeLanguages: resolveCodeLanguage,
        }),
        syntaxHighlighting(codeHighlight),
        livePreview,
        tableAutoFormat,
        headingFolding,
        editorModes,
        imageResolver.of(async () => null),
        activationClicks,
        activationHandler.of(() => {}),
        attachmentEvents(async () => null),
        urlPasteLink,
        EditorView.lineWrapping,
      ],
    }),
  });

  // 手元検証用（ブラウザのコンソールから触れるように）
  (window as unknown as { benchView: EditorView }).benchView = view;

  // パーサのウォームアップ（起動直後の遅延解析を待つ）
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 次の描画フレーム。ペインが非表示だと rAF が止まるので 40ms で諦める
  const nextFrame = () =>
    new Promise<number | null>((resolve) => {
      const giveUp = setTimeout(() => resolve(null), 40);
      requestAnimationFrame(() => {
        clearTimeout(giveUp);
        resolve(performance.now());
      });
    });

  // 文書中の段落へ順繰りにカーソルを置いて 1 文字挿入する。
  // 主計測は dispatch（CM6 の同期 DOM 更新）まで。非表示ページはタイマーも
  // rAF も絞られるので、ループは同期で回す。描画込みの値は可視のとき
  // だけ、別途少数のサンプルで集める
  const lines = view.state.doc.lines;
  const dispatchSamples: number[] = [];
  const frameSamples: number[] = [];
  for (let index = 0; index < KEYSTROKES; index++) {
    const line = view.state.doc.line(1 + ((index * 37) % lines));
    view.dispatch({ selection: { anchor: line.to } }); // 位置決めは計測外
    const started = performance.now();
    view.dispatch({
      changes: { from: line.to, insert: "あ" },
      selection: { anchor: line.to + 1 },
      userEvent: "input.type",
    });
    dispatchSamples.push(performance.now() - started);
  }
  if (!document.hidden) {
    for (let index = 0; index < 60; index++) {
      const line = view.state.doc.line(1 + ((index * 53) % lines));
      view.dispatch({ selection: { anchor: line.to } });
      await nextFrame();
      const started = performance.now();
      view.dispatch({
        changes: { from: line.to, insert: "あ" },
        selection: { anchor: line.to + 1 },
        userEvent: "input.type",
      });
      const painted = await nextFrame();
      if (painted !== null) frameSamples.push(painted - started);
    }
  }

  dispatchSamples.sort((a, b) => a - b);
  frameSamples.sort((a, b) => a - b);
  const p95 = Number(percentile(dispatchSamples, 95).toFixed(2));
  const framePart =
    frameSamples.length >= 30
      ? `描画込み: p50 = ${percentile(frameSamples, 50).toFixed(2)}ms / p95 = ${percentile(frameSamples, 95).toFixed(2)}ms（${frameSamples.length} 標本）`
      : `描画込み: 計測不可（ページ非表示で rAF 停止。${frameSamples.length} 標本）`;
  const verdict = p95 < BUDGET_MS ? "合格" : "不合格";
  out.textContent = [
    `文書: ${doc.length} 文字 / 約 ${words} 語 / ${lines} 行`,
    `打鍵 ${KEYSTROKES} 回`,
    `dispatch（同期 DOM 更新）: p50 = ${percentile(dispatchSamples, 50).toFixed(2)}ms / p95 = ${p95}ms / max = ${dispatchSamples[dispatchSamples.length - 1].toFixed(2)}ms`,
    framePart,
    `基準: p95 < ${BUDGET_MS}ms → ${verdict}`,
  ].join("\n");
  (window as unknown as { benchResult: object }).benchResult = {
    words,
    dispatchP50: Number(percentile(dispatchSamples, 50).toFixed(2)),
    dispatchP95: p95,
    frameP95:
      frameSamples.length >= 30
        ? Number(percentile(frameSamples, 95).toFixed(2))
        : null,
    frameSamples: frameSamples.length,
    verdict,
  };
}

void run();
