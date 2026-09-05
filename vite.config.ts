import { defineConfig } from "vite";
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
