// 選択肢だけの窓。未保存の復元（H-1）・外部での削除・競合の 3 択
// （spec §7.5）が同じ形なので 1 つにする。**外側を押しても閉じない** —
// 選ばずに済ませられない問いなので、逃げ道を作らない。

export type Choice = {
  label: string;
  onChoose: () => void;
};

export function ChoiceDialog({
  title,
  text,
  choices,
}: {
  title: string;
  text?: string;
  choices: readonly Choice[];
}) {
  return (
    <div className="palette-backdrop">
      <div className="palette" role="dialog" aria-label={title}>
        <header className="palette-title">{title}</header>
        {text && <p className="dialog-text">{text}</p>}
        <div className="conflict-actions">
          {choices.map((choice) => (
            <button key={choice.label} onClick={choice.onChoose}>
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
