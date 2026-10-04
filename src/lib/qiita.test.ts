// Qiita へ送る形に整える（TASKS 14-2 / ADR-0063 の決定）。通信なしで全部見る。

import { describe, expect, test } from "vitest";
import { qiitaCliFile, qiitaDraft } from "./qiita";

const draft = (text: string, embeds?: Map<string, string>) =>
  qiitaDraft(text, "ファイル名", embeds);

describe("題と本文（ADR-0063 案 5）", () => {
  test("test_front_matter_と先頭の_H1_を外し_H1_を題にする", () => {
    const result = draft("---\nqiita: abc\n---\n# 設計メモ\n\n本文です。\n");
    expect(result.title).toBe("設計メモ");
    expect(result.body).toBe("本文です。\n");
  });

  test("test_題の装飾は外す", () => {
    expect(draft("# **太字**の`題`\n\n本文\n").title).toBe("太字の題");
  });

  test("test_H1_が無ければ渡した名前を題にし_本文はそのまま", () => {
    const result = draft("## 節\n\n本文\n");
    expect(result.title).toBe("ファイル名");
    expect(result.body).toBe("## 節\n\n本文\n");
  });

  test("test_コードの中の_#_は題にしない", () => {
    const result = draft("```sh\n# コメント\n```\n");
    expect(result.title).toBe("ファイル名");
    expect(result.body).toContain("# コメント");
  });
});

describe("タグ（決定 1: 本文の #タグ を初期値に）", () => {
  test("test_本文の_#タグ_を出てきた順に重複なしで拾う", () => {
    const result = draft("# 題\n\n#Rust と #tauri の話\n\n#rust\n");
    expect(result.tags).toEqual(["Rust", "tauri"]);
  });

  test("test_コードの中と見出しは_タグにしない", () => {
    const result = draft(
      "# 題\n\n## 見出し\n\n`#インライン`\n\n```\n#フェンス\n```\n",
    );
    expect(result.tags).toEqual([]);
  });

  test("test_タグだけの行は本文から外す（タグは_Qiita_のタグへ。要望_2026-10-05）", () => {
    const result = draft("# 題\n\n本文です。\n\n#Rust #tauri\n");
    expect(result.body).toBe("本文です。\n");
    expect(result.tags).toEqual(["Rust", "tauri"]);
  });

  test("test_文中の_#タグ_は印だけ外して語を残す", () => {
    expect(draft("# 題\n\n#Rust の話\n").body).toBe("Rust の話\n");
  });

  test("test_コードの中の_#_は触らない", () => {
    const text = "# 題\n\n```sh\n#コメント\n```\n\n`#インライン`\n";
    expect(draft(text).body).toBe("```sh\n#コメント\n```\n\n`#インライン`\n");
  });
});

describe("qiita-cli の記事ファイル（要望 2026-10-05）", () => {
  const sample = {
    title: '設計: "メモ"',
    body: "本文です。\n",
    tags: ["Rust", "Tauri"],
    localImages: [],
  };

  test("test_qiita-cli_と同じ_front_matter_と本文", () => {
    expect(qiitaCliFile(sample, null)).toBe(
      [
        "---",
        'title: "設計: \\"メモ\\""',
        "tags:",
        '  - "Rust"',
        '  - "Tauri"',
        "private: true",
        'updated_at: ""',
        "id: null",
        "organization_url_name: null",
        "slide: false",
        "ignorePublish: false",
        "---",
        "本文です。",
        "",
      ].join("\n"),
    );
  });

  test("test_投稿済みのノートは記事_ID_と更新時刻を入れる（qiita-cli_で同じ記事の更新になる）", () => {
    const file = qiitaCliFile(sample, {
      id: "c686397e4a0f4f11683d",
      updatedAt: "2026-10-02T10:00:00+09:00",
    });
    expect(file).toContain('id: "c686397e4a0f4f11683d"');
    expect(file).toContain('updated_at: "2026-10-02T10:00:00+09:00"');
    // 決定 2: 外に出す操作をアプリで完了させない（公開は Qiita の画面で）
    expect(file).toContain("private: true");
  });

  test("test_タグは_5_個まで_無ければ空の項目を_1_つ置く", () => {
    const many = qiitaCliFile(
      { ...sample, tags: ["a", "b", "c", "d", "e", "f"] },
      null,
    );
    expect(many).toContain('  - "e"');
    expect(many).not.toContain('  - "f"');
    // qiita-cli の雛形と同じ（埋めないと投稿で断られる = 気付ける）
    expect(qiitaCliFile({ ...sample, tags: [] }, null)).toContain(
      'tags:\n  - ""\n',
    );
  });
});

describe("独自の記法を素の文字に（決定 4）", () => {
  test("test_[[リンク]]_は別名か名前にする", () => {
    expect(draft("# 題\n\n[[設計]] と [[設計|手引き]]\n").body).toBe(
      "設計 と 手引き\n",
    );
  });

  test("test_::マーカー::_は印を外す_std::vector_は触らない", () => {
    expect(draft("# 題\n\n::大事::な話と std::vector\n").body).toBe(
      "大事な話と std::vector\n",
    );
  });

  test("test_寄せの囲みは外して中身を残す_note_は残す", () => {
    const text =
      "# 題\n\n:::center\n真ん中\n:::\n\n:::right\n右\n:::\n\n:::note info\n注意\n:::\n";
    expect(draft(text).body).toBe("真ん中\n\n右\n\n:::note info\n注意\n:::\n");
  });

  test("test_文字色の_span_は外して中身を残す_他の_span_は触らない", () => {
    const text =
      '# 題\n\n<span style="color: #c0392b">赤</span>と<span class="x">素</span>\n';
    expect(draft(text).body).toBe('赤と<span class="x">素</span>\n');
  });

  test("test_コードの中は触らない", () => {
    const code =
      '```\n[[a]] ::b:: <span style="color: red">c</span>\n:::center\n```\n';
    expect(draft(`# 題\n\n${code}\n\`[[a]]\` と \`::b::\`\n`).body).toBe(
      `${code}\n\`[[a]]\` と \`::b::\`\n`,
    );
  });

  test("test_Qiita_も読める記法はそのまま", () => {
    const text = [
      "# 題",
      "",
      "$$",
      "a^2",
      "$$",
      "",
      "```mermaid",
      "graph TD; A-->B",
      "```",
      "",
      "```ruby:app.rb",
      "puts 1",
      "```",
      "",
      ":::details 畳み",
      "中身",
      ":::",
      "",
    ].join("\n");
    expect(draft(text).body).toBe(text.replace("# 題\n\n", ""));
  });
});

describe("埋め込み（決定 4）", () => {
  test("test_行まるごとの_![[ノート]]_は中身に置き換え_中の記法も直す", () => {
    const embeds = new Map([["部品", "---\nx: 1\n---\n部品の本文 [[b]]\n"]]);
    expect(draft("# 題\n\n![[部品]]\n\n後\n", embeds).body).toBe(
      "部品の本文 b\n\n後\n",
    );
  });

  test("test_引けない埋め込みと文中の埋め込みは名前にする", () => {
    expect(draft("# 題\n\n![[無い]]\n\n文中の ![[部品]] も\n").body).toBe(
      "無い\n\n文中の 部品 も\n",
    );
  });
});

describe("画像（決定 3: 警告してそのまま送る）", () => {
  test("test_保管フォルダの中の画像を数え_https_は数えない", () => {
    const result = draft(
      "# 題\n\n![図](attachments/a.png)\n\n![外](https://example.com/y.png)\n\n![同じ](attachments/a.png)\n",
    );
    expect(result.localImages).toEqual(["attachments/a.png"]);
    // リンクはそのまま送る（Qiita の画面で貼り直す）
    expect(result.body).toContain("![図](attachments/a.png)");
  });

  test("test_大きさの指定は外す（Qiita は_alt_に字のまま出す）", () => {
    expect(draft("# 題\n\n![図|320](https://example.com/a.png)\n").body).toBe(
      "![図](https://example.com/a.png)\n",
    );
  });

  test("test_コードの中の画像は数えない", () => {
    expect(draft("# 題\n\n`![a](b.png)`\n").localImages).toEqual([]);
  });
});
