import { resolve } from "path";

import { defineConfig } from "vite";
import { comlink } from "vite-plugin-comlink";

// https://vitejs.dev/config/
export default defineConfig({
  alias: {
    "~": resolve(__dirname, "src"),
  },
  plugins: [comlink()],
  worker: {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    plugins: [comlink()],
  },
});
