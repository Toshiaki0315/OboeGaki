// サイドバーのフォルダの節（ADR-0024）。**見出しがそのまま保管フォルダの行**
// （要望 2026-09-05）で、同じ場所を指す「直下」の行を下に並べない。三角を
// 押すと開閉、名前を押すと直下で絞る。作る操作は右クリックへ。
// **ゴミ箱もフォルダの中に置く。** 押すと一覧が捨てたノートに変わり、
// ノートを落とすと捨てる。
//
// 落とし先の強調（どの行に載っているか）は**この節だけが持つ**。掴み終わり
// （dragend）や節の外への drop は窓ぜんぶで拾って消す。

import { useEffect, useState } from "react";
import { TRASH_FOLDER } from "../lib/finder";
import { folderDepth, folderLabel } from "../lib/folder-tree";
import { isNoteDrag, NOTE_DRAG_TYPE } from "../lib/note-drop";
import type { FolderCount } from "../stores/app";
import { MenuIcon } from "./MenuIcon";

type DragLike = { dataTransfer: DataTransfer };

export type FolderSectionProps = {
  /// 直下を除いたフォルダ（見出しが直下の役をする）
  folders: readonly FolderCount[];
  rootCount: number;
  trashCount: number;
  /// 絞っているフォルダ。null は絞っていない、"" は直下、TRASH_FOLDER はゴミ箱
  folderFilter: string | null;
  open: boolean;
  onToggle: () => void;
  onFilter: (folder: string | null) => void;
  onFolderMenu: (at: { folder: string; x: number; y: number }) => void;
  onTrashMenu: (at: { x: number; y: number }) => void;
  /// 掴んでいるものをそのフォルダへ落とせるか（同じ場所への移動は断る）
  acceptsDrop: (event: DragLike, folder: string) => boolean;
  /// 落とされた。carried は dataTransfer に載っていた目印（無ければ空文字）
  onDrop: (folder: string, carried: string) => void;
  onDropTrash: (carried: string) => void;
};

export function FolderSection({
  folders,
  rootCount,
  trashCount,
  folderFilter,
  open,
  onToggle,
  onFilter,
  onFolderMenu,
  onTrashMenu,
  acceptsDrop,
  onDrop,
  onDropTrash,
}: FolderSectionProps) {
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [dropTrash, setDropTrash] = useState(false);

  useEffect(() => {
    // 掴み終わり・節の外への drop でも強調を残さない
    const clear = () => {
      setDropFolder(null);
      setDropTrash(false);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  /// **受け口はボタンではなく行に置く。** WebKit ではボタンがドラッグの
  /// 出来事を飲んでしまう。あわせて **dragenter と dragover の両方を止める**
  /// — dragover だけで受けられるのは Chrome の甘さで、WebKit はこれが
  /// 無いと落とせない（実機で発覚 2026-09-04: 掴めるのに落とせない）
  const dropHandlers = (folder: string) => ({
    onDragEnter: (event: React.DragEvent) => {
      if (!acceptsDrop(event, folder)) return;
      event.preventDefault();
      setDropFolder(folder);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!acceptsDrop(event, folder)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropFolder(folder);
    },
    onDragLeave: () =>
      setDropFolder((current) => (current === folder ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDropFolder(null);
      onDrop(folder, event.dataTransfer.getData(NOTE_DRAG_TYPE));
    },
  });

  const menuHandler =
    (folder: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onFolderMenu({ folder, x: event.clientX, y: event.clientY });
    };

  return (
    <details className="folder-section" open={open}>
      {/* **色は見出しの行ぜんぶに敷く。** 帯の左端を中のフォルダと揃える
        （要望 2026-09-05） */}
      <summary
        className={
          (folderFilter === "" ? "selected" : "") +
          (dropFolder === "" ? " drop-target" : "")
        }
        onClick={(event) => {
          event.preventDefault(); // 開閉はこちらで持つ（タグと排他）
          onToggle();
        }}
        {...dropHandlers("")}
      >
        <span className="side-twist" aria-hidden="true" />
        <button
          className="folder-row folder-head"
          title="右クリックで作る（ノートを落とすと直下へ移せます）"
          onClick={(event) => {
            event.preventDefault(); // summary の開閉を巻き込まない
            event.stopPropagation();
            onFilter(folderFilter === "" ? null : "");
          }}
          onContextMenu={menuHandler("")}
        >
          <MenuIcon name="folder" />
          <span className="folder-name">フォルダ</span>
          <span className="folder-count">{rootCount}</span>
        </button>
      </summary>
      <ul>
        {folders.map(({ folder, count }) => (
          <li key={folder || "."} {...dropHandlers(folder)}>
            <button
              className={
                `folder-row${folder === folderFilter ? " selected" : ""}` +
                (folder === dropFolder ? " drop-target" : "")
              }
              // **見出しより 1 段下げる**（要望 2026-09-05）。見出しと頭が
              // 揃っていると、中のフォルダが同じ高さのものに見える
              style={{ paddingLeft: `${1.8 + folderDepth(folder) * 0.8}rem` }}
              title="右クリックで作る・名前を変える・消す（ノートを落とすと移せます）"
              onClick={() => onFilter(folder === folderFilter ? null : folder)}
              onContextMenu={menuHandler(folder)}
            >
              <MenuIcon name="folder" />
              <span className="folder-name">{folderLabel(folder)}</span>
              <span className="folder-count">{count}</span>
            </button>
          </li>
        ))}
        <li
          onDragEnter={(event) => {
            if (!isNoteDrag(Array.from(event.dataTransfer.types))) return;
            event.preventDefault();
            setDropTrash(true);
          }}
          onDragOver={(event) => {
            if (!isNoteDrag(Array.from(event.dataTransfer.types))) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTrash(true);
          }}
          onDragLeave={() => setDropTrash(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropTrash(false);
            onDropTrash(event.dataTransfer.getData(NOTE_DRAG_TYPE));
          }}
        >
          <button
            className={
              `folder-row${folderFilter === TRASH_FOLDER ? " selected" : ""}` +
              (dropTrash ? " drop-target" : "")
            }
            // 書き始めは見出しの「フォルダ」と揃える（要望 2026-09-05）。
            // 中のフォルダより 1 段浅い
            style={{ paddingLeft: "1.8rem" }}
            title="捨てたノートを見る（落とすと捨てます。右クリックで空にできます）"
            onClick={() =>
              onFilter(folderFilter === TRASH_FOLDER ? null : TRASH_FOLDER)
            }
            onContextMenu={(event) => {
              event.preventDefault();
              onTrashMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            <MenuIcon name="trash" />
            <span className="folder-name">ゴミ箱</span>
            <span className="folder-count">{trashCount}</span>
          </button>
        </li>
      </ul>
    </details>
  );
}
