import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolveDevPort } from "./src/lib/dev-port";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// 既定 1430。OBOEGAKI_DEV_PORT で変更できる（tauri.conf.json の devUrl も
// 合わせる必要があるため、Makefile が同じ値を --config で渡している）
// @ts-expect-error process is a nodejs global
const { port, hmrPort } = resolveDevPort(process.env);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // テストの共通の後始末（jsdom の cleanup）。環境は各ファイルの先頭で宣言する
  test: {
    setupFiles: ["src/test-setup.ts"],
    // Claude Code の作業フォルダ（.claude/worktrees/ に別の checkout が丸ごと
    // 置かれる）を拾わない。拾うと別の版のテストが 1 回ぶん余計に走り、
    // make check が赤くなった（2026-09-27。138 件がすべてその中）
    exclude: [...configDefaults.exclude, ".claude/**"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
