import { defineConfig } from "astro/config";

// 纯静态输出：不接任何适配器，产物直接可扔 GitHub Pages / Cloudflare Pages
export default defineConfig({
  output: "static",
});
