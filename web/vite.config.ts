import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = dirname(fileURLToPath(import.meta.url));

// 构建产物统一落到仓库根 dist，服务端只认这一个目录。
export default defineConfig({
  root: WEB,
  plugins: [react()],
  build: {
    outDir: resolve(WEB, "..", "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8790",
    },
  },
});
