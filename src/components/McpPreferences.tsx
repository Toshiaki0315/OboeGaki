// 環境設定「MCP」タブ（ADR-0051 / TASKS 10-6）。Claude Desktop などから
// ノートを読み書きさせるための設定。**使わない人の方が多い**ので「一般」から
// 分けた（要望 2026-09-12）。ここは表示と依頼だけで、断片を組むのは Rust 側。

export type McpPreferencesProps = {
  /// MCP の設定（Claude Desktop 用の JSON 断片）をクリップボードへ
  onCopyMcpConfig: () => void;
};

export function McpPreferences({ onCopyMcpConfig }: McpPreferencesProps) {
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
          <button onClick={() => onCopyMcpConfig()}>設定をコピー</button>
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
        見せたくないフォルダは、保管フォルダ直下の .mcp-ignore に 1 行 1 つ
        書いてください。そこは探しても出てこず、読むことも書くこともできません
        （ゴミ箱と雛形は、書かなくても最初から見えません）。
      </p>
    </div>
  );
}
