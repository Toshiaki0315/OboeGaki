// 環境設定「MCP」タブ（ADR-0051 / TASKS 10-6）。Claude Desktop などから
// ノートを読み書きさせるための設定。**使わない人の方が多い**ので「一般」から
// 分けた（要望 2026-09-12）。ここは表示と依頼だけで、断片を組むのは Rust 側。
//
// 押した結果は**この場に出す**。クリップボードは目に見えないので、何も
// 起きないと「押せたのか」が分からない（要望 2026-09-12）。画面下の
// ステータス欄はダイアログの裏に隠れていて見えない

import { useEffect, useState } from "react";

export type McpPreferencesProps = {
  /// MCP の設定（Claude Desktop 用の JSON 断片）をクリップボードへ。
  /// **写せたかを返す** — 黙って成功に見せない
  onCopyMcpConfig: () => Promise<boolean>;
};

/// 知らせを消すまで（ミリ秒）。読める長さは残し、居座らせない
const NOTICE_MS = 3000;

export function McpPreferences({ onCopyMcpConfig }: McpPreferencesProps) {
  const [notice, setNotice] = useState<string | null>(null);

  // 出しっぱなしにしない。押し直すたびに数え直す（notice が変わると
  // 前の timer は下の後始末で落ちる）
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  async function copy() {
    // 押し直しても分かるよう、一度消してから出す
    setNotice(null);
    const copied = await onCopyMcpConfig();
    setNotice(copied ? "コピーしました" : "コピーできませんでした");
  }

  return (
    <div className="pref-page">
      <h3 className="pref-section">Claude Desktop などからノートを使う</h3>
      <p className="pref-note">
        つなぐと、Claude からノートを探す・読む・作る・足すができます。
        <strong>ノートは手元から出ません</strong>
        （ネットワークには出ず、このパソコンの中だけで読み書きします）。
        使わないなら、何もしなくて構いません。
      </p>
      <div className="preferences-fields">
        {/* button を label で包まない。読み上げの名前が label の字になって
            「設定をコピー」が消える */}
        <div className="pref-vault-row">
          <button onClick={() => void copy()}>設定をコピー</button>
          {/* 読み上げにも届くよう live に。空のときも枠は残して、出た
              瞬間にボタンが動かないようにする */}
          <span className="pref-notice" role="status" aria-live="polite">
            {notice}
          </span>
        </div>
      </div>
      <h3 className="pref-section">つなぎ方</h3>
      <p className="pref-note">
        上の「設定をコピー」を押し、Claude Desktop の設定ファイル
        （claude_desktop_config.json）に貼って、Claude Desktop を開き直します。
        はじめての方は、ヘルプメニューの「Claude とつなぐ（MCP）の手引きを置く」
        から、手順を書いたノートを出せます。
      </p>
      <h3 className="pref-section">見せない場所</h3>
      <p className="pref-note">
        見せたくないフォルダやノートは、サイドバー・一覧で
        <strong>右クリック →「Claude に渡さない」</strong>
        で切り替えられます（ピン留めと同じ手触りです）。そこは探しても出て
        こず、読むことも書くこともできません。中身は保管フォルダ直下の
        .mcp-ignore に溜まります。ゴミ箱と雛形は、書かなくても最初から
        見えません。
      </p>
    </div>
  );
}
