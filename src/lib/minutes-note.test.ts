// 文字起こしと議事録を 1 枚のノートに組む（TASKS 28-3 / ADR-0070 の「形」）。

import { describe, expect, test } from "vitest";
import { lengthLabel, minutesNote } from "./minutes-note";

const base = {
  date: "2026-10-09",
  sourceName: "ラズパイで試す工場共通言語OPC_UA.m4a",
  duration: 1257.75,
  attachment: "attachments/2026-10-09-0700.m4a",
  minutes: "## 要旨\n\n工場の共通言語の話。\n",
  lines: "[00:00] あの世界中の人が\n[00:20] 実はこれ\n",
};

describe("minutesNote", () => {
  test("test_題_元の録音へのリンク_議事録_畳んだ全文の順", () => {
    const note = minutesNote(base);
    expect(note.title).toBe(
      "議事録 2026-10-09 ラズパイで試す工場共通言語OPC_UA",
    );
    expect(note.text).toBe(
      [
        "# 議事録 2026-10-09 ラズパイで試す工場共通言語OPC_UA",
        "",
        "[元の録音（21 分）](attachments/2026-10-09-0700.m4a)",
        "",
        "## 要旨",
        "",
        "工場の共通言語の話。",
        "",
        ":::details 文字起こし（音声認識。話者は分かれていません）",
        "[00:00] あの世界中の人が",
        "[00:20] 実はこれ",
        ":::",
        "",
      ].join("\n"),
    );
  });

  test("test_動画なら元の動画と書く", () => {
    const note = minutesNote({
      ...base,
      sourceName: "定例.mov",
      attachment: "attachments/a.mov",
    });
    expect(note.text).toContain("[元の動画（21 分）](attachments/a.mov)");
  });

  test("test_添付に写さなければ元の名前だけを添える", () => {
    const note = minutesNote({ ...base, attachment: null });
    expect(note.text).toContain(
      "元の録音: ラズパイで試す工場共通言語OPC_UA.m4a（21 分）",
    );
    expect(note.text).not.toContain("](");
  });

  test("test_議事録が無ければ文字起こしだけで_そう言う", () => {
    const note = minutesNote({ ...base, minutes: null });
    expect(note.text).toContain(
      "議事録は作っていません（アシスタントが使えませんでした）",
    );
    expect(note.text).toContain(":::details 文字起こし");
  });

  test("test_添付の名前に括弧や空白があってもリンクが切れない", () => {
    const note = minutesNote({
      ...base,
      attachment: "attachments/会議 (1).m4a",
    });
    expect(note.text).toContain("](<attachments/会議 (1).m4a>)");
  });
});

describe("lengthLabel", () => {
  test("test_分_1_時間を超えたら時間と分", () => {
    expect(lengthLabel(30)).toBe("1 分未満");
    expect(lengthLabel(1257.75)).toBe("21 分");
    expect(lengthLabel(3900)).toBe("1 時間 5 分");
  });
});
