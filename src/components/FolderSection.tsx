// サイドバーのフォルダの節（ADR-0024）。**見出しがそのまま保管フォルダの行**
// （要望 2026-09-05）で、同じ場所を指す「直下」の行を下に並べない。三角を
// 押すと開閉、名前を押すと直下で絞る。作る操作は右クリックへ。
// **ゴミ箱もフォルダの中に置く。** 押すと一覧が捨てたノートに変わり、
// ノートを落とすと捨てる。
//
// 落とし先の強調（どの行に載っているか）は**この節だけが持つ**。掴み終わり
// （dragend）や節の外への drop は窓ぜんぶで拾って消す。

import { useEffect, useState, useRef } from "react";
import { TRASH_FOLDER } from "../lib/finder";
import {
  folderDepth,
  folderLabel,
  hasSubfolders,
  visibleFolders,
  folderCount,
} from "../lib/folder-tree";
import {
  isNoteDrag,
  NOTE_DRAG_TYPE,
  FOLDER_DRAG_TYPE,
  canMoveFolderInto,
  isFolderDrag,
} from "../lib/note-drop";
import type { FolderCount } from "../lib/ipc";
import { MenuIcon } from "./MenuIcon";

type DragLike = { dataTransfer: DataTransfer };

/// 畳んだフォルダの記憶（要望 2026-09-08）。参照実装は開き直しのあいだ
/// だけ覚えていたが、こちらは次の起動まで覚える。置き場所は注入
/// （WebView 無しでテストできる形。useSearch と同じ作法）
export const COLLAPSED_KEY = "oboegaki.folders-collapsed";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function loadCollapsed(storage: StorageLike): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveCollapsed(storage: StorageLike, collapsed: ReadonlySet<string>) {
  try {
    storage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // 覚えられなくても畳めてはいる
  }
}

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
  /// フォルダをフォルダへ落とした（要望 2026-09-10）。into は空文字で直下
  onDropFolder: (into: string, folder: string) => void;
  /// 畳んだフォルダを覚える置き場所（App は localStorage）
  storage: StorageLike;
};

/// 右端の件数。直下が 0 で中にノートがあるときは合計を括弧で出す
/// （`folderCount`）。括弧の意味は Tip で補う。
function FolderCountBadge({
  folder,
  count,
  folders,
}: {
  folder: string;
  count: number;
  folders: readonly FolderCount[];
}) {
  const shown = folderCount(folder, count, folders);
  return (
    <span
      className={`folder-count${shown.inner ? " inner" : ""}`}
      title={
        shown.inner
          ? `直下には無く、中のフォルダに ${shown.text.slice(1, -1)} 件`
          : undefined
      }
    >
      {shown.text}
    </span>
  );
}

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
  onDropFolder,
  storage,
}: FolderSectionProps) {
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  // 掴んでいるフォルダ。WebKit は dragover の間 getData を読ませないので、
  // 何を掴んだかは自分で覚える（ノートの draggingNote と同じ理由）
  const draggingFolder = useRef<string | null>(null);
  const [dropTrash, setDropTrash] = useState(false);
  // 畳んでいるフォルダ。既定は全部開く（参照実装の expandAll と同じ）
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    loadCollapsed(storage),
  );
  function toggleCollapsed(folder: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      saveCollapsed(storage, next);
      return next;
    });
  }

  useEffect(() => {
    // 掴み終わり・節の外への drop でも強調を残さない
    const clear = () => {
      setDropFolder(null);
      setDropTrash(false);
      draggingFolder.current = null;
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
  /// 掴んでいるものをこのフォルダへ落とせるか。フォルダなら自分で判断し、
  /// ノートは App の acceptsDrop に聞く
  const accepts = (event: React.DragEvent, folder: string) => {
    const moving =
      draggingFolder.current ??
      (isFolderDrag(Array.from(event.dataTransfer.types))
        ? event.dataTransfer.getData(FOLDER_DRAG_TYPE) || null
        : null);
    if (moving !== null) return canMoveFolderInto(moving, folder);
    return acceptsDrop(event, folder);
  };
  const dropHandlers = (folder: string) => ({
    onDragEnter: (event: React.DragEvent) => {
      if (!accepts(event, folder)) return;
      event.preventDefault();
      setDropFolder(folder);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!accepts(event, folder)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropFolder(folder);
    },
    onDragLeave: () =>
      setDropFolder((current) => (current === folder ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDropFolder(null);
      // 目印は**型の一覧にあるときだけ**読む（ノートの落下で読むと、
      // 実装によってはノートのパスが返る）
      const carriedFolder = isFolderDrag(Array.from(event.dataTransfer.types))
        ? event.dataTransfer.getData(FOLDER_DRAG_TYPE)
        : "";
      const moving = draggingFolder.current || carriedFolder;
      draggingFolder.current = null;
      if (moving) {
        if (canMoveFolderInto(moving, folder)) onDropFolder(folder, moving);
        return;
      }
      onDrop(folder, event.dataTransfer.getData(NOTE_DRAG_TYPE));
    },
  });
  /// フォルダの行を掴む（要望 2026-09-10）。目印はフォルダ専用の型
  const dragHandlers = (folder: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      draggingFolder.current = folder;
      event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder);
      event.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      draggingFolder.current = null;
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
          <FolderCountBadge folder="" count={rootCount} folders={folders} />
        </button>
      </summary>
      <ul>
        {visibleFolders(folders, collapsed).map(({ folder, count }) => (
          <li key={folder || "."} {...dropHandlers(folder)}>
            <button
              {...dragHandlers(folder)}
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
              {/* 子を持つフォルダだけ三角。押しても絞らない（開閉だけ）。
                葉は同じ幅の空白で頭を揃える */}
              {hasSubfolders(folder, folders) ? (
                <span
                  className={`side-twist folder-twist${collapsed.has(folder) ? "" : " open"}`}
                  role="button"
                  aria-label={
                    collapsed.has(folder)
                      ? `「${folderLabel(folder)}」を開く`
                      : `「${folderLabel(folder)}」を畳む`
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleCollapsed(folder);
                  }}
                />
              ) : (
                <span
                  className="side-twist folder-twist leaf"
                  aria-hidden="true"
                />
              )}
              <MenuIcon name="folder" />
              <span className="folder-name">{folderLabel(folder)}</span>
              <FolderCountBadge
                folder={folder}
                count={count}
                folders={folders}
              />
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
