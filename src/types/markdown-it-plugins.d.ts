// 型定義を同梱しない markdown-it プラグインの宣言。
// 引数は use() 側が検査するので、ここでは緩く受ける。

declare module "markdown-it-footnote" {
  const plugin: (md: unknown) => void;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  const plugin: (md: unknown, options?: { enabled?: boolean }) => void;
  export default plugin;
}
