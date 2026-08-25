import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "marketing"),
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("osx-"),
        },
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 4192,
    strictPort: true,
  },
  build: {
    outDir: resolve(projectRoot, "dist-marketing"),
    emptyOutDir: true,
  },
});
