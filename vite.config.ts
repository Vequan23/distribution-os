import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
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
    port: 4190,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4191",
    },
  },
  build: {
    outDir: "dist",
  },
});
