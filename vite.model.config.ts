import { defineConfig } from "vite";

// 把契约内核打成单文件 ESM，供 scripts/agent-batch.mjs 在 Node 中直接 import。
export default defineConfig({
  build: {
    outDir: "dist-model",
    emptyOutDir: true,
    lib: {
      entry: "src/model/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [],
    },
    minify: false,
  },
});
