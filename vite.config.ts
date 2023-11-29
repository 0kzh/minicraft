import { defineConfig } from "vite";
import { comlink } from "vite-plugin-comlink";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [comlink()],
});
