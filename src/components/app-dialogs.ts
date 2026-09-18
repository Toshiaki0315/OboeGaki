// 今開いているダイアログ（20-2）。App.tsx は 16 本の useState で窓の開閉を
// 別々に持っていた。**1 つの状態で持つ**ので、同時に 2 つ開くことが表現できない
// （右ペインの RightPane、右クリックの OpenMenu と同じ構え）。
// 名前を 1 つ聞く窓 5 種（PromptDialog）は、題や欄の字面をここで決めて
// App は 1 回だけ描く。外部の変更・削除・復元の 3 択は useNoteSync が持つ。

import type { OutlineItem } from "../editor/outline";
import { folderLabel } from "../lib/folder-tree";
import type { HistoryEntry } from "../lib/ipc";
import { noteStem } from "../lib/note-path";
import type { Finding } from "../lib/style-check";

export type OpenDialog =
  /// 見出しへ飛ぶパレット（Cmd+R）
  | { kind: "headings"; items: OutlineItem[] }
  /// ノート名で開く（Cmd+O）
  | { kind: "quickOpen" }
  /// 雛形を選んで作る（Cmd+Shift+N）
  | { kind: "templates"; paths: string[] }
  /// 日付を選んでその日のノートへ（7-5）
  | { kind: "day"; date: string }
  /// タグの改名・統合（12-4）
  | { kind: "tag"; tag: string }
  /// フォルダの作成（folder は親。"" は直下）・改名（folder は対象）
  | { kind: "folder"; mode: "create" | "rename"; folder: string }
  /// フォルダへ移動。path が null なら開いているノート
  | { kind: "move"; path: string | null }
  | { kind: "preferences" }
  /// 表の挿入（行 × 列を聞く）
  | { kind: "table" }
  /// 文体の指摘（U-4）
  | { kind: "styleCheck"; findings: Finding[] }
  /// リンクの図（M-2）。depth は次に組み直すときの既定
  | { kind: "graph"; svg: string; dropped: number; depth: number }
  /// 検索式をサイドバーに保存する名前
  | { kind: "saveSearch"; query: string }
  /// ノートをテンプレートに登録する名前
  | { kind: "template"; path: string }
  /// 版の履歴。base は開いた時点の本文（差分の「今」。ADR-0054）
  | { kind: "history"; entries: HistoryEntry[]; base: string };

export type DialogKind = OpenDialog["kind"];

/// 名前や日付を 1 つ聞く窓（PromptDialog で描く）
export type PromptDialogKind =
  "day" | "tag" | "folder" | "saveSearch" | "template";
export type OpenPrompt = Extract<OpenDialog, { kind: PromptDialogKind }>;

const PROMPT_KINDS: ReadonlySet<DialogKind> = new Set<DialogKind>([
  "day",
  "tag",
  "folder",
  "saveSearch",
  "template",
]);

export function isPrompt(dialog: OpenDialog): dialog is OpenPrompt {
  return PROMPT_KINDS.has(dialog.kind);
}

export type PromptSpec = {
  title: string;
  label: string;
  defaultValue: string;
  type?: "date";
  note?: string;
  confirmLabel: string;
};

/// 問いの字面。押したときに何が起きるかは App（confirmPrompt）
export function promptSpec(dialog: OpenPrompt): PromptSpec {
  switch (dialog.kind) {
    case "day":
      return {
        title: "日付を選んで開く",
        label: "日付",
        type: "date",
        defaultValue: dialog.date,
        note: "その日のノートが無ければ、日次の雛形から作ります。",
        confirmLabel: "開く",
      };
    case "tag":
      return {
        title: `タグ「#${dialog.tag}」の名前を変更`,
        label: "新しい名前",
        defaultValue: dialog.tag,
        note: "全ノートの本文の #タグ を書き換えます。既にある名前にすると、そのタグに統合されます。",
        confirmLabel: "決定",
      };
    case "folder":
      return {
        title:
          dialog.mode === "create"
            ? dialog.folder
              ? `「${dialog.folder}」の中に新しいフォルダ`
              : "新しいフォルダ"
            : `「${dialog.folder}」の名前を変更`,
        label: "名前",
        defaultValue:
          dialog.mode === "rename" ? folderLabel(dialog.folder) : "",
        confirmLabel: "決定",
      };
    case "saveSearch":
      return {
        title: "検索を保存",
        label: "サイドバーに出す名前",
        // 既定は式そのもの（短い式ならそのまま通せる）
        defaultValue: dialog.query,
        note: `検索式: ${dialog.query}`,
        confirmLabel: "保存",
      };
    case "template":
      return {
        title: "テンプレートに登録",
        label: "名前",
        defaultValue: noteStem(dialog.path),
        note: "見出しは {{title}} に置き換わります（この雛形から作ったノートには新しい題名が入ります）。",
        confirmLabel: "登録",
      };
  }
}
