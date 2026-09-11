// サイドバーの「やること」（ADR-0056 / 12-5）。全ノートの未完了を 1 つの節に
// 集める。開閉はフォルダ・タグと排他なので親が持つ。

import type { TaskRow } from "../lib/ipc";
import { noteStem } from "../lib/note-path";
import { MenuIcon } from "./MenuIcon";

export type TaskSectionProps = {
  tasks: readonly TaskRow[];
  open: boolean;
  onToggle: () => void;
  /// 文を押した: そのノートのその行へ（path は相対、line は 0 始まり）
  onOpen: (path: string, line: number) => void;
  /// 箱を押した: 完了にする
  onComplete: (path: string, line: number) => void;
};

/// 期限は短く（今年なら月/日）。表の幅を取らない
export function shortDue(due: string): string {
  const [year, month, day] = due.split("-");
  const thisYear = String(new Date().getFullYear());
  return year === thisYear ? `${month}/${day}` : `${year}/${month}/${day}`;
}

export function TaskSection({
  tasks,
  open,
  onToggle,
  onOpen,
  onComplete,
}: TaskSectionProps) {
  return (
    <details className="task-section" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault(); // 開閉はこちらで持つ（フォルダ・タグと排他）
          onToggle();
        }}
      >
        <span className="side-twist" aria-hidden="true" />
        <MenuIcon name="task" />
        <span className="side-label">やること</span>
        <span className="side-count">{tasks.length}</span>
      </summary>
      <ul>
        {tasks.map((task) => (
          <li key={`${task.path}:${task.line}`} className="task-row">
            <input
              type="checkbox"
              aria-label={`${task.text} を完了にする`}
              onChange={() => onComplete(task.path, task.line)}
            />
            <button
              className="task-text"
              title={task.path}
              onClick={() => onOpen(task.path, task.line)}
            >
              <span className="task-body">{task.text}</span>
              <span className="task-meta">
                <span className="task-note">{noteStem(task.path)}</span>
                {task.due && (
                  <span className="task-due">{shortDue(task.due)}</span>
                )}
              </span>
            </button>
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="no-hits">未完了のやることはありません</li>
        )}
      </ul>
    </details>
  );
}
