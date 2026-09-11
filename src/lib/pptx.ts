// PowerPoint への書き出し（TASKS 4-5 / F-5）。
//
// **ざっくり作って手で整える**前提。凝ったレイアウトは狙わない
// （参照実装 editor/pptx_export.py と同じ構え）。
//
// 割り方は lib/slides.ts（F-4）が決めていて、ここは組み立てだけを持つ。
// 置き方もユーザーと決めたものを引き継ぐ:
// **`#` は表紙、`##` ごとに 1 枚、画像は右側。**
//
// **書き出しは止めない。** 画像が読めなくても、そこだけ飛ばしてファイルを
// 作る。1 枚のリンク切れで書き出せないほうが困る。
//
// pptxgenjs は大きいので動的 import にする（図 = ADR-0037 と同じ）。

import { CODE_RUN_COLORS, type CodeRun } from "./export-code";
import { codeKey } from "./export-html";
import {
  cardsOf,
  type Card,
  type Deck,
  type Run,
  type SlideBlock,
  type SlideImage,
} from "./slides";
import { DEFAULT_SLIDE_THEME, type SlideTheme } from "./slide-theme";
import { applyThemeParts, themeParts, type ThemeParts } from "./slide-template";
import { slideMetrics, type SlideMetrics } from "./slide-grid";
import {
  bodyFrames,
  bodyLayout,
  LABEL_H,
  type BodyLayout,
} from "./slide-frame";
import { DEFAULT_PPTX_SETTINGS } from "./pptx-settings";

/// 用紙の名前（`defineLayout` に渡す。GR-06）
const LAYOUT_NAME = "OBOEGAKI_PAGE";
/// PowerPoint の箇条書きは 0〜8 段
const MAX_LEVEL = 8;
/// 共通の体裁の名前（スライド番号とフッタを載せる）
const MASTER = "OBOEGAKI_MASTER";

/// 画像を data URL へ解決する（読めなければ null）。vault を知っている
/// 呼び出し側の仕事。
export type ImageResolver = (url: string) => Promise<string | null>;

/// デッキを `.pptx` にして base64 で返す。
/// 書き出しの体裁（環境設定 8-1 から来る。TASKS 8-2）。
///
/// **画面の設定をそのまま渡さない。** ここが要るのは「今の書き出しが
/// 実際に使う値」だけで、増やすときは使う側と一緒に増やす。
export type PptxOptions = {
  footer: { pageNumber: boolean; text: string; showDate: boolean };
  decoration: { imageCaption: boolean; codeLanguageLabel: boolean };
  /// 日付を出すときの「今日」。テストで固定できるように受け取る。
  today?: Date;
  /// 用紙と余白と字の大きさ（8-3）。**唯一の入口は `slideMetrics()`**。
  metrics: SlideMetrics;
  /// コードの字句ごとの色分け（TASKS 12-12）。鍵は `codeKey(言語, 本文)`。
  /// 字句の解析は非同期なので、呼ぶ側が先に済ませて渡す（図と同じ手口）。
  /// 無ければ単色
  codeRuns?: Map<string, CodeRun[]>;
};

export const DEFAULT_PPTX_OPTIONS: PptxOptions = {
  footer: { pageNumber: true, text: "", showDate: false },
  decoration: { imageCaption: false, codeLanguageLabel: true },
  metrics: slideMetrics(DEFAULT_PPTX_SETTINGS),
};

/// フッタに出す字。**空なら題名**（今までどおり）。日付は末尾に足す。
function footerText(deck: Deck, options: PptxOptions): string {
  const base = options.footer.text || deck.title;
  if (!options.footer.showDate) return base;
  const day = stamp(options.today ?? new Date());
  return base ? `${base}　${day}` : day;
}

/// `2026-09-06`。**画面と同じ並び**（年から書く。並べ替えで崩れない）。
function stamp(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

export async function buildPptx(
  deck: Deck,
  resolveImage: ImageResolver,
  /// ノートの front matter から読んだ見た目（TASKS 5-5）
  theme: SlideTheme = DEFAULT_SLIDE_THEME,
  /// テンプレートから借りた配色と書体（TASKS 5-6 / ADR-0045 案 A）
  borrowed: ThemeParts | null = null,
  options: PptxOptions = DEFAULT_PPTX_OPTIONS,
): Promise<string> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  // **用紙は設定から**（GR-01 / GR-06）。`LAYOUT_16x9` は 10in なので使わない
  const sheet = options.metrics;
  pptx.defineLayout({
    name: LAYOUT_NAME,
    width: sheet.width,
    height: sheet.height,
  });
  pptx.layout = LAYOUT_NAME;
  // 書体は全体の既定に置く（枠ごとに書くと、あとで足した枠で付け忘れる）
  if (theme.font) {
    pptx.theme = { headFontFace: theme.font, bodyFontFace: theme.font };
  }
  // 共通の体裁（TASKS 5-3）。**ページ番号とフッタは全部の枚に要る** —
  // 手で足すと抜けが出る。pptxgenjs はテンプレートの .pptx を読めないので、
  // マスタはここで組む（ADR-0039 の道具立ての制約）
  pptx.defineSlideMaster({
    title: MASTER,
    objects: [
      {
        line: {
          x: sheet.margin,
          y: sheet.footerLineY,
          w: sheet.width - sheet.margin * 2,
          h: 0,
          line: { color: "bg2", width: 0.75 },
        },
      },
      ...(footerText(deck, options)
        ? [
            {
              text: {
                text: footerText(deck, options),
                options: {
                  x: sheet.margin,
                  y: sheet.footerY,
                  w: sheet.width / 2,
                  h: 0.3,
                  fontSize: 10,
                  color: "tx2",
                },
              },
            },
          ]
        : []),
    ],
    // ページ番号は出さない設定にもできる（CFG-50）。**表紙と扉には
    // 出さない**という決まりは pptxgenjs のマスタでは表せないので、
    // 今は全枚に出す（CFG-53 は用紙の作り直しと一緒に見直す）
    ...(options.footer.pageNumber
      ? {
          slideNumber: {
            x: sheet.width - sheet.margin - sheet.gutter * 3,
            y: sheet.footerY,
            w: sheet.gutter * 3,
            h: 0.3,
            align: "right" as const,
            fontSize: 10,
            color: "tx2",
          },
        }
      : {}),
  });

  if (deck.title || deck.subtitle) {
    const cover = pptx.addSlide();
    cover.addText(deck.title || "無題", {
      x: sheet.margin,
      y: sheet.coverTitleY,
      w: sheet.width - sheet.margin * 2,
      h: sheet.titleH * 1.4,
      fontSize: Math.round(sheet.points.title * 1.33),
      bold: true,
    });
    if (deck.subtitle) {
      cover.addText(deck.subtitle, {
        x: sheet.margin,
        y: sheet.coverSubtitleY,
        w: sheet.width - sheet.margin * 2,
        h: sheet.titleH,
        fontSize: 20,
        color: "tx2", // テーマの副色（テンプレートに追従する）
      });
    }
  }

  for (const slide of deck.slides) {
    // 扉は題だけを大きく真ん中に（TASKS 5-3）
    if (slide.kind === "section") {
      const divider = pptx.addSlide({ masterName: MASTER });
      divider.addText(slide.title, {
        x: sheet.margin,
        y: sheet.height / 2 - sheet.titleH / 2,
        w: sheet.width - sheet.margin * 2,
        h: 1.4,
        fontSize: 36,
        bold: true,
        align: "center",
        valign: "middle",
      });
      if (slide.notes) divider.addNotes(slide.notes);
      continue;
    }
    const page = pptx.addSlide({ masterName: MASTER });
    page.addText(slide.title, {
      x: sheet.margin,
      y: sheet.titleY,
      w: sheet.width - sheet.margin * 2,
      h: sheet.titleH,
      fontSize: sheet.points.title,
      bold: true,
      color: theme.accent,
    });
    // 本文と画像の割り方は `slide-frame.ts` が決める（**縦の用紙では
    // 画像が上に来る** = GR-04。プレビューも同じ計算を使う）
    const images = await embedImages(slide.images, resolveImage);
    const layout = bodyLayout(sheet, images.length);
    // 小見出しが 2 つ以上あれば横並びの箱にする（TASKS 5-4）
    const cards = images.length === 0 ? cardsOf(slide.blocks) : null;
    if (cards) placeCards(page, cards, theme, sheet);
    else
      placeBlocks(
        page,
        slide.blocks,
        layout,
        theme,
        sheet,
        options.decoration.codeLanguageLabel,
        options.codeRuns,
      );
    placeImages(page, images, layout, sheet, options.decoration.imageCaption);
    if (slide.notes) page.addNotes(slide.notes);
  }
  const built = (await pptx.write({ outputType: "base64" })) as string;
  return borrowed ? await paintWith(built, borrowed) : built;
}

/// 出来上がった `.pptx` の `theme1.xml` を、借りた配色と書体で塗り替える。
///
/// **後段で入れ替える。** pptxgenjs には配色を入れる口が無い
/// （`pptx.theme` は書体だけ。ADR-0045 の実測）。
/// 失敗したら**そのまま返す** — テンプレートが読めないだけで書き出せなく
/// なるほうが困る。
async function paintWith(base64: string, parts: ThemeParts): Promise<string> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const file = zip.file(THEME_PATH);
    if (!file) return base64;
    zip.file(THEME_PATH, applyThemeParts(await file.async("string"), parts));
    return await zip.generateAsync({ type: "base64" });
  } catch {
    return base64;
  }
}

/// テンプレート（`.pptx` の中身）から借りるところを読む。読めなければ null。
export async function readTemplateTheme(
  bytes: Uint8Array,
): Promise<ThemeParts | null> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const file = zip.file(THEME_PATH);
    if (!file) return null;
    return themeParts(await file.async("string"));
  } catch {
    return null; // zip ですらない・壊れている
  }
}

const THEME_PATH = "ppt/theme/theme1.xml";

/// 読めた画像だけを返す（読めないものは飛ばす。書き出しは止めない）。
/// 画像を data URL に解決する。**説明も一緒に運ぶ**（CFG-72）。
type Placed = { data: string; alt: string };

async function embedImages(
  images: readonly SlideImage[],
  resolveImage: ImageResolver,
): Promise<Placed[]> {
  const found: Placed[] = [];
  for (const image of images) {
    const data = await resolveImage(image.url);
    if (data) found.push({ data, alt: image.alt });
  }
  return found;
}

type Page = ReturnType<
  InstanceType<typeof import("pptxgenjs").default>["addSlide"]
>;

/// 装飾つきの 1 かたまりを pptxgenjs の形に直す（TASKS 5-1）。
///
/// **書いた装飾をそのまま渡す。** 素の文字にすると、書いた人が PowerPoint
/// 側で付け直すことになる。等幅はインラインコードの印。
function textRun(run: Run, base: object, theme: SlideTheme) {
  return {
    text: run.text,
    options: {
      ...base,
      ...(run.bold ? { bold: true } : {}),
      ...(run.italic ? { italic: true } : {}),
      ...(run.strike ? { strike: true } : {}),
      ...(run.code ? { fontFace: theme.mono } : {}),
      ...(run.link ? { hyperlink: { url: run.link } } : {}),
      ...(run.color ? { color: run.color } : {}),
    },
  };
}

/// 横並びの箱（TASKS 5-4）。**箱は同じ幅で割る** — 中身の量で幅を変えると、
/// 資料ごとに並びが揺れて落ち着かない。
function placeCards(
  page: Page,
  cards: Card[],
  theme: SlideTheme,
  sheet: SlideMetrics,
): void {
  const gap = sheet.gutter * 1.5;
  // **縦の用紙では縦に積む**（GR-04）。横に 3 つ並べると 1 つが細長い帯に
  // なって、字が縦 1 列で落ちてくる
  const stacked = sheet.height > sheet.width;
  const width = stacked
    ? sheet.width - sheet.margin * 2
    : (sheet.width - sheet.margin * 2 - gap * (cards.length - 1)) /
      cards.length;
  const available = sheet.bodyH - sheet.gutter * 2;
  const height = stacked
    ? (available - gap * (cards.length - 1)) / cards.length
    : available;
  cards.forEach((card, index) => {
    const left = stacked ? sheet.margin : sheet.margin + (width + gap) * index;
    const top = stacked
      ? sheet.bodyTop + (height + gap) * index
      : sheet.bodyTop;
    page.addShape("roundRect", {
      x: left,
      y: top,
      w: width,
      h: height,
      fill: { color: "bg2" },
      rectRadius: 0.08,
    });
    page.addText(
      card.heading.map((run, at) =>
        textRun(
          run,
          {
            fontSize: sheet.points.heading,
            bold: true,
            color: theme.accent,
            ...(at === card.heading.length - 1 ? { breakLine: true } : {}),
          },
          theme,
        ),
      ),
      {
        x: left + 0.2,
        y: top + sheet.gutter,
        w: width - 0.4,
        h: 0.5,
        valign: "top",
      },
    );
    const body = flowRuns(card.blocks, theme, sheet);
    if (body.length > 0) {
      page.addText(body, {
        x: left + 0.2,
        y: top + sheet.gutter * 3.75,
        w: width - 0.4,
        h: height - 0.95,
        valign: "top",
      });
    }
  });
}

/// 文章・箇条書き・小見出しを 1 つの枠に流す形に直す。
function flowRuns(
  blocks: readonly SlideBlock[],
  theme: SlideTheme,
  sheet: SlideMetrics,
) {
  return blocks.flatMap((block) => {
    if (block.kind === "code" || block.kind === "table") return [];
    const heading = block.kind === "heading";
    return block.runs.map((run, index) =>
      textRun(
        run,
        {
          fontSize: heading ? sheet.points.heading : sheet.points.body,
          ...(heading ? { bold: true, color: theme.accent } : {}),
          ...(index === 0 && block.kind === "bullet"
            ? { bullet: true, indentLevel: Math.min(block.level, MAX_LEVEL) }
            : {}),
          ...(index === block.runs.length - 1 ? { breakLine: true } : {}),
        },
        theme,
      ),
    );
  });
}

function placeBlocks(
  page: Page,
  blocks: SlideBlock[],
  layout: BodyLayout,
  theme: SlideTheme,
  sheet: SlideMetrics,
  labelCode = DEFAULT_PPTX_OPTIONS.decoration.codeLanguageLabel,
  codeRuns?: Map<string, CodeRun[]>,
): void {
  // 置き場所は `slide-frame.ts` が決める（プレビューと同じ計算 = PV-01）
  for (const frame of bodyFrames(blocks, layout, labelCode, sheet)) {
    if (frame.kind === "flow") {
      page.addText(flowRuns(frame.blocks, theme, sheet), {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        valign: "top",
      });
    } else if (frame.kind === "code" && frame.block.kind === "code") {
      // 言語名を小さく添える（CFG-73）。**書いていないときは足さない**
      if (frame.label) {
        page.addText(frame.label, {
          x: frame.x,
          y: frame.y - LABEL_H,
          w: frame.w,
          h: LABEL_H - 0.02,
          fontSize: 9,
          color: "tx2",
        });
      }
      // 字句ごとの色分けが渡っていれば run に割る（TASKS 12-12）。
      // 無ければ今までどおりの単色
      const runs = codeRuns?.get(
        codeKey(frame.block.language, frame.block.text),
      );
      const codeText = runs
        ? runs.map((run) => ({
            text: run.text,
            options: {
              ...(run.cls && CODE_RUN_COLORS[run.cls]
                ? { color: CODE_RUN_COLORS[run.cls] }
                : {}),
              ...(run.breakLine ? { breakLine: true } : {}),
            },
          }))
        : frame.block.text;
      page.addText(codeText, {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        fontSize: sheet.points.code,
        fontFace: theme.mono,
        fill: { color: "bg2" },
        color: "tx1",
        valign: "top",
        // 字が縁にくっつくと窮屈に見える（画面の帯と同じ考え方）
        margin: 8,
      });
    } else if (frame.kind === "table" && frame.block.kind === "table") {
      const cells = frame.block.rows.map((row) =>
        row
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim()),
      );
      if (cells.length === 0) continue;
      // **見出しの行を塗る**（TASKS 5-2）。1 行目が見出しなのは
      // Markdown の表の決まりで、区切り行は slides.ts が落としている
      const rows = cells.map((row, index) =>
        row.map((cell) => ({
          text: cell,
          options:
            index === 0
              ? { bold: true, color: "bg1", fill: { color: theme.accent } }
              : index % 2 === 0
                ? { fill: { color: "bg2" } } // 縞にして行を追いやすく
                : {},
        })),
      );
      page.addTable(rows, {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        fontSize: sheet.points.table,
        border: { pt: 0.5, color: "bg2" },
        autoPage: false,
      });
    }
  }
}

function placeImages(
  page: Page,
  images: readonly Placed[],
  layout: BodyLayout,
  sheet: SlideMetrics,
  caption = DEFAULT_PPTX_OPTIONS.decoration.imageCaption,
): void {
  images.forEach(({ data, alt }, index) => {
    const box = layout.images[index];
    if (!box) return;
    // 説明を出すぶんだけ絵を縮める（重ねると字が読めない）
    const captionH = caption && alt ? sheet.points.body / 72 + 0.1 : 0;
    page.addImage({
      data,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h - captionH,
      sizing: { type: "contain", w: box.w, h: box.h - captionH },
    });
    if (captionH === 0) return;
    page.addText(alt, {
      x: box.x,
      y: box.y + box.h - captionH,
      w: box.w,
      h: captionH,
      fontSize: Math.max(8, Math.round(sheet.points.body * 0.7)),
      color: "tx2",
      align: "center",
    });
  });
}
