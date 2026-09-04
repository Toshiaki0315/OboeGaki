# ADR-0043: WebView のネイティブ drag&drop 横取りを切る

- **日付**: 2026-09-04
- **状態**: 採用
- **決めること**: `tauri.conf.json` の `dragDropEnabled`（既定 `true`）

## 背景

ノートをフォルダの行へ落として移す（要望 2026-09-04）を入れたところ、
**掴めるのに、どこにも落とせない**という報告が上がった。落とし先の行が
光りもしない ＝ `dragenter` / `dragover` が画面に届いていない。

最初は決まりの取りこぼしを疑った（`dragover` だけを止めていて `dragenter`
を止めていなかった。Chrome は甘いが WebKit は決まりどおり）。直したが
症状は変わらなかった。

## 調べたこと

依存の実物を読んだ。

`wry-0.55.1/src/wkwebview/drag_drop.rs:44-50`:

```rust
let listener = &this.ivars().drag_drop_handler;
if !listener(DragDropEvent::Enter { paths, position }) {
    // Reject the Wry file drop (invoke the OS default behaviour)
    unsafe { objc2::msg_send![super(this), draggingEntered: drag_info] }
} else {
    NSDragOperation::Copy
}
```

ハンドラが入っていると `WryWebView` が `draggingEntered` /
`draggingUpdated` / `performDragOperation` を横取りし、**ハンドラが受けた
ときは `super`（＝ WebKit）へ渡さない**。

`tauri-runtime-wry-2.11.4/src/lib.rs:4862-4896` は、その `drag_drop_handler`
の中で Tauri のイベントを飛ばし、**常に `true` を返す**。

macOS では、画面の中で始めたドラッグも AppKit の
`NSDraggingDestination` を通って WebView に入る。したがって
**画面の中の drag&drop も丸ごと横取りされ、WebKit には一切届かない。**

Tauri の設定の説明は「HTML5 の drag&drop を使うには Windows では切る必要が
ある」としか書いていない（`tauri-utils-2.9.3/src/config.rs:1945`）が、
**実際には macOS でも同じことが起きる**。

## 決定

`dragDropEnabled: false` にする。

- 画面の中の drag&drop（ノート → フォルダ）が WebKit の手で動く
- Finder から落とした画像も、DOM の `drop` に `dataTransfer.files` として
  届く。本文への貼り込み（`src/editor/attachments.ts`）は元からこの形を
  待っていたので、**こちらも同時に生き返る**（横取りされている間は
  死んでいたはず）
- 失うのは Tauri 側の `tauri://drag-drop` イベント。**使っていない**
  （`grep` で参照ゼロ）

設定が戻ってしまわないよう、`src-tauri/src/lib.rs` の
`test_設定でドラッグの横取りを切ってある` が値を見張る。

## 影響

- `docs/manual_test.md` に「Finder から画像を落として貼り込める」を追加
- 将来 Tauri のネイティブな file drop を使いたくなったら、この ADR ごと
  見直す（画面の中の drag&drop と両立しない）
