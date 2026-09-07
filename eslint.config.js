// ESLint（TASKS 9-2）。React の hooks の規則（依存配列・呼び出し順）と、
// TypeScript の基本的な取りこぼしを `make check` で見る。書式は prettier が
// 持つので、ここでは見ない。

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "src-tauri/", "spikes/", "fixtures/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // 使わないことを `_` で示した束は許す（`const { text: _drop, ...rest }`）
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // 全角の空白は日本語の文字列に普通に出る（PowerPoint のフッタなど）
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipTemplates: true, skipComments: true },
      ],
      // 依存配列の漏れは見逃したくないので warn ではなく error
      "react-hooks/exhaustive-deps": "error",
      // **React Compiler 向けの規則は今は切る。** このアプリは Compiler を
      // 使っておらず、「描画中に ref を読む」「effect の中で setState」は
      // App.tsx の設計（最新値を ref に写す・派生 state を effect で揃える）
      // そのもの。直すなら hooks への切り出し（TASKS 9-3）と一緒に。
      // 見つかった件数: refs 18 / set-state-in-effect 9 / immutability 3 /
      // purity 1（2026-09-07）
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },
);
